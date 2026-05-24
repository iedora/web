package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ── Logging ──────────────────────────────────────────────────────────────────

func step(n int, msg string) {
	fmt.Printf("%s %d/%d  %s\n", logPrefix, n, totalSteps, msg)
}

// stepOf is step() with a caller-supplied total — used by the destroy
// path, which has a different step count than apply.
func stepOf(n, total int, msg string) {
	fmt.Printf("%s %d/%d  %s\n", logPrefix, n, total, msg)
}

func info(format string, args ...any) {
	fmt.Fprintf(os.Stderr, logPrefix+" "+format+"\n", args...)
}

func warn(format string, args ...any) {
	fmt.Fprintf(os.Stderr, logPrefix+" WARN: "+format+"\n", args...)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, logPrefix+" "+format+"\n", args...)
	os.Exit(1)
}

// ── Repo root ────────────────────────────────────────────────────────────────

// findRepoRoot walks up from the current working directory looking for
// a `bun.lock` marker. Robust against the binary's location and the
// caller's `cd`: works from `go run ./cmd/dev` at infra/, from `bin/dev`
// invoked anywhere inside the repo, or from a CI shim running at the
// repo root.
func findRepoRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		fail("getwd: %v", err)
	}
	dir := cwd
	for {
		if _, err := os.Stat(filepath.Join(dir, "bun.lock")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			fail("repo root not found (no bun.lock from %s upward)", cwd)
		}
		dir = parent
	}
}

// ── Subprocess execution ─────────────────────────────────────────────────────

// runIn runs `name args...` in `dir`, streaming stdout+stderr to the
// orchestrator's stdout+stderr. Fails the process on non-zero exit.
func runIn(dir, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("%s %v: %v", name, args, err)
	}
}

// runQuiet runs a command best-effort: streams output but does NOT
// exit the orchestrator on non-zero. Used by destroyDevStack — each
// teardown step continues on failure (partial state should never
// block a reset).
func runQuiet(dir, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()
}

// removeInfraContainers force-removes every container with an `infra-`
// name prefix. Catches the orphans `tofu destroy` doesn't see (e.g.
// a container created by a failed apply that never landed in state).
// Best-effort: skips silently if docker isn't reachable.
func removeInfraContainers() {
	out, err := exec.Command("docker", "ps", "-aq", "--filter", "name=infra-").Output()
	if err != nil {
		return
	}
	ids := strings.Fields(strings.TrimSpace(string(out)))
	if len(ids) == 0 {
		return
	}
	args := append([]string{"rm", "-f"}, ids...)
	_ = exec.Command("docker", args...).Run()
}

// runInWithEnv is runIn with extra env vars layered on top of the
// inherited environment. Used to pass `TF_VAR_zitadel_jwt_profile`
// (multi-line JSON with quotes) to `tofu apply` without shell-escaping.
func runInWithEnv(dir string, extraEnv []string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), extraEnv...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("%s %v: %v", name, args, err)
	}
}

// captureIn runs the command for its stdout, fails on non-zero exit.
// Whitespace-trimmed; suitable for one-line outputs (e.g. `tofu output`).
func captureIn(dir, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		fail("%s %v: %v", name, args, err)
	}
	return strings.TrimSpace(string(out))
}

// ── Waiting on external signals ──────────────────────────────────────────────

// waitForHTTP200 blocks until the URL returns a 2xx response, or the
// timeout elapses. Two-stage probe so we don't hammer the daemon with
// HTTP requests against a port that isn't even open yet:
//
//   1. TCP dial — fast, kernel-level. `connection refused` returns in
//      microseconds; we backoff briefly and retry. Once the dial
//      succeeds, the server is at least binding the port.
//   2. HTTP GET against the same URL. Returns when status/100 == 2.
//
// No long sleeps. The first stage paces itself via the connect-refused
// loop (kernel makes us wait ~1ms per refusal); the second is bounded
// by an explicit short timeout per request. Total time-to-detect on
// the typical case (Zitadel boot ~10s) is "spin briefly, then detect
// the first 200 within ~50ms of it being ready".
func waitForHTTP200(probeURL string, timeout time.Duration) error {
	parsed, err := url.Parse(probeURL)
	if err != nil {
		return fmt.Errorf("invalid URL %q: %w", probeURL, err)
	}
	host := parsed.Host
	if !strings.Contains(host, ":") {
		// no explicit port — default for the scheme
		if parsed.Scheme == "https" {
			host += ":443"
		} else {
			host += ":80"
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	client := &http.Client{Timeout: 2 * time.Second}

	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("timed out after %s waiting for %s", timeout, probeURL)
		}

		// Stage 1: kernel-level TCP probe. Cheap, doesn't waste an HTTP
		// round-trip on a port that isn't listening yet.
		conn, derr := net.DialTimeout("tcp", host, 200*time.Millisecond)
		if derr != nil {
			// Connection refused / no route — server not yet binding.
			// The DialTimeout itself paces us; no extra sleep needed.
			continue
		}
		_ = conn.Close()

		// Stage 2: HTTP request. Server might bind the port milliseconds
		// before the handler starts answering — retry on transient errors.
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
		resp, herr := client.Do(req)
		if herr == nil {
			ready := resp.StatusCode/100 == 2
			_ = resp.Body.Close()
			if ready {
				return nil
			}
		}
		// Brief pause only when port is up but service isn't 2xx yet.
		// Spread across the timeout window without burning the CPU.
		time.Sleep(50 * time.Millisecond)
	}
}

// composePort resolves the host URL a container's internal port maps
// to. Useful for the post-apply summary line (e.g. "menu at http://
// localhost:3000"). Replaces the old docker-compose port lookup with
// a direct `docker port` query — no compose dependency.
func composePort(container, internal string) string {
	out, err := exec.Command("docker", "port", container, internal).Output()
	if err != nil {
		return "(docker port " + container + " " + internal + " failed)"
	}
	raw := strings.TrimSpace(string(out))
	// Multiple lines (IPv4 + IPv6); take the first.
	if idx := strings.IndexByte(raw, '\n'); idx >= 0 {
		raw = raw[:idx]
	}
	if idx := strings.LastIndex(raw, ":"); idx >= 0 {
		return localhostHTTP + raw[idx:]
	}
	return raw
}

// readFileWhenReady reads `path` once it exists with non-zero size.
// Used to ingest the FirstInstance-minted SA key after Zitadel reports
// healthy — by then the file MUST be on disk (FirstInstance runs to
// completion before /debug/ready flips green), but a couple of ms of
// filesystem propagation can race the docker event. Bounded loop with
// short steps: ~10ms × 50 = 500ms ceiling, no large sleeps.
func readFileWhenReady(path string) ([]byte, error) {
	for i := 0; i < 50; i++ {
		if info, err := os.Stat(path); err == nil && info.Size() > 0 {
			return os.ReadFile(path)
		}
		time.Sleep(10 * time.Millisecond)
	}
	return nil, fmt.Errorf("file never appeared with content: %s", path)
}
