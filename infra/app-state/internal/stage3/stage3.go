// Package stage3 holds the shared Stage 3 boilerplate every db-migrations
// configurator needs: resolving Tofu outputs, composing the GHCR image
// tag, instantiating the SSH client, then delegating to
// infra/migrate.RemoteRun. Internal because only the per-product Stage
// 3 wrappers in infra/app-state/* call into it.
//
// Per-product wrappers (infra/app-state/<name>-db-migrations/main.go)
// stay distinct so the orchestrator's appConfigurators slice in
// configurators.go can register, gate, and name them individually —
// but the body of each wrapper is one Spec lookup + one RunStage3Migrate
// call.
package stage3

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/eduvhc/iedora/infra/migrate"
	"github.com/eduvhc/iedora/internal/ssh"
)

// remoteSSH is the package-level SSH executor. All db-migrations
// configurators stream output to stderr because they're non-interactive
// — every line is a log entry, not a value the operator parses.
var remoteSSH = &ssh.Client{Stdout: os.Stderr, Stderr: os.Stderr}

// RunStage3Migrate resolves the prod execution context for Spec s and
// hands off to infra/migrate.RemoteRun. Specs whose TofuOutputDBURL is
// empty (e.g. imopush before Stage 4 lands) skip gracefully — the
// configurator stays registered so adding the tofu output is the only
// switch needed to start applying.
func RunStage3Migrate(ctx context.Context, s migrate.Spec) error {
	if s.TofuOutputDBURL == "" {
		fmt.Fprintf(os.Stderr,
			"→ %s-db-migrations: not deployable yet (no tofu output) — skipping\n",
			s.Name,
		)
		return nil
	}

	host, err := tofuOutput(ctx, "hetzner_ipv4")
	if err != nil {
		return fmt.Errorf("read hetzner_ipv4: %w", err)
	}
	if host == "" {
		return fmt.Errorf("hetzner_ipv4 empty — has `bin/iedora-env tofu -chdir=infra/iac/tofu apply` run?")
	}

	dbURL, err := tofuOutput(ctx, s.TofuOutputDBURL)
	if err != nil {
		return fmt.Errorf("read %s: %w", s.TofuOutputDBURL, err)
	}
	if dbURL == "" {
		return fmt.Errorf("%s empty — likely a Tofu schema drift", s.TofuOutputDBURL)
	}

	owner := envOr("GHCR_OWNER", "eduvhc")
	network := envOr("IEDORA_DOCKER_NETWORK", "iedora")
	image := fmt.Sprintf("ghcr.io/%s/migrate:latest", owner)

	return migrate.RemoteRun(ctx, s, migrate.RemoteConfig{
		SSH:         remoteSSH,
		Host:        host,
		Image:       image,
		Network:     network,
		DatabaseURL: dbURL,
		GHCRToken:   os.Getenv("IAC_BOOTSTRAP_GHCR_TOKEN"),
		GHCROwner:   owner,
	})
}

// RepoRoot resolves the absolute path of the repo root from CWD or
// $INFRA_DIR. Mirrors the heuristic in
// infra/deploy/cmd/iedora/paths.go::iacDir.
func RepoRoot() string {
	if d := os.Getenv("INFRA_DIR"); d != "" {
		return filepath.Dir(d) // INFRA_DIR is .../infra/iac; parent is repo root
	}
	if cwd, err := os.Getwd(); err == nil {
		for _, candidate := range []string{
			cwd,
			filepath.Dir(cwd),
			filepath.Dir(filepath.Dir(cwd)),
		} {
			if _, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil {
				return candidate
			}
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 6; i++ {
			if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "."
}

// tofuOutput shells out to `tofu -chdir=<iac>/tofu output -raw <name>`.
// The state-passphrase + R2 backend env vars are already hydrated by
// `bin/iedora-env`.
func tofuOutput(ctx context.Context, name string) (string, error) {
	iac := iacDir()
	cmd := exec.CommandContext(ctx, "tofu",
		"-chdir="+filepath.Join(iac, "tofu"), "output", "-raw", name)
	cmd.Env = os.Environ()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tofu output %s: %w (%s)", name, err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

func iacDir() string {
	if d := os.Getenv("INFRA_DIR"); d != "" {
		return d
	}
	if cwd, err := os.Getwd(); err == nil {
		for _, candidate := range []string{
			cwd,
			filepath.Join(cwd, "infra", "iac"),
		} {
			if _, err := os.Stat(filepath.Join(candidate, "tofu")); err == nil {
				return candidate
			}
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 6; i++ {
			if _, err := os.Stat(filepath.Join(dir, "tofu")); err == nil {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "."
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
