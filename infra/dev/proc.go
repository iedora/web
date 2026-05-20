// Process & I/O helpers. No business logic — just the thin layer that
// the rest of the orchestrator uses to shell out, capture output,
// emit log lines, and wait on external signals.
//
// Wait helpers prefer push-based signals over polling: docker events
// is a streaming API, so as soon as the daemon flips a container's
// health status we get the line on stdout — zero `time.Sleep`. The
// few polling fallbacks here exist only where the producer doesn't
// expose a stream we can subscribe to.

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
	"runtime"
	"strings"
	"time"
)

// ── Logging ──────────────────────────────────────────────────────────────────

func step(n int, msg string) {
	fmt.Printf("%s %d/%d  %s\n", logPrefix, n, totalSteps, msg)
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

// findRepoRoot walks up from this source file (compiled-in path) to
// the repo root. dev.go lives at infra/dev/dev.go, so three Dir() ups.
func findRepoRoot() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		fail("runtime.Caller failed")
	}
	return filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
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

// splitLines parses `tofu output -json` for a list-of-strings output
// and returns each element as a separate string. Lightweight parse —
// the JSON shapes coming out of TF list outputs are always flat
// `["a","b"]`, no nested escaping to worry about.
func splitLines(jsonArray string) []string {
	jsonArray = strings.TrimSpace(jsonArray)
	jsonArray = strings.TrimPrefix(jsonArray, "[")
	jsonArray = strings.TrimSuffix(jsonArray, "]")
	parts := strings.Split(jsonArray, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.Trim(strings.TrimSpace(p), `"`)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// readEnvVar reads one KEY's value from an env-file at `path`.
// Returns "" if file or key is missing — no error path; the caller
// is just probing for an optional default.
func readEnvVar(path, key string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	prefix := key + "="
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimPrefix(line, prefix)
		}
	}
	return ""
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
