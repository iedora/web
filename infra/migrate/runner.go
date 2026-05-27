package migrate

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// LocalConfig is the runner state for the `iedora migrate` (local dev /
// CI) execution path.
type LocalConfig struct {
	// Docker network the migrate container joins. Defaults to "iedora"
	// (the dev compose network). CI uses "host" since the postgres
	// service container is exposed via host ports.
	Network string

	// Postgres host as seen from inside the migrate container.
	// "infra-postgres" with --network iedora; "localhost" with
	// --network host.
	PGHost string

	// Postgres TCP port. Defaults to "5432".
	PGPort string

	// Postgres username. Defaults to "postgres".
	PGUser string

	// Postgres password. Defaults to "Password1!" (dev compose).
	PGPassword string

	// Docker image tag. The dev path builds and tags as
	// "iedora-migrate:local"; CI may reuse that or override.
	ImageTag string

	// TraceparentEnv — `TRACEPARENT=<traceparent-value>` to pass via
	// docker run -e. Empty means no propagation.
	TraceparentEnv string

	// Extra env vars to pass through (e.g. OTEL_EXPORTER_OTLP_ENDPOINT).
	// Each is a `KEY=value` string.
	ExtraEnv []string
}

func (c LocalConfig) databaseURL(dbName string) string {
	port := c.PGPort
	if port == "" {
		port = "5432"
	}
	user := c.PGUser
	if user == "" {
		user = "postgres"
	}
	host := c.PGHost
	if host == "" {
		host = "infra-postgres"
	}
	return fmt.Sprintf(
		"postgresql://%s:%s@%s:%s/%s",
		user, c.PGPassword, host, port, dbName,
	)
}

// LocalRun applies one Spec via local `docker run`. Caller provides the
// active context (used for cancellation + as a span parent if OTel is
// wired in by the caller).
func LocalRun(ctx context.Context, s Spec, cfg LocalConfig) error {
	args := []string{"run", "--rm", "--network", cfg.Network}
	args = append(args, "-e", s.URLEnv+"="+cfg.databaseURL(s.DBName))
	if cfg.TraceparentEnv != "" {
		args = append(args, "-e", cfg.TraceparentEnv)
	}
	for _, kv := range cfg.ExtraEnv {
		args = append(args, "-e", kv)
	}
	args = append(args, cfg.ImageTag, s.ScriptPath)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// RemoteSSH is the subset of the ssh.Client interface RemoteRun needs.
// Keeping it as an interface lets the caller pass a real
// *github.com/eduvhc/iedora/internal/ssh.Client without us importing
// it here (which would create a circular-ish dependency with the
// app-state configurators).
type RemoteSSH interface {
	Exec(ctx context.Context, host, cmd string) error
}

// RemoteConfig is the runner state for the Stage 3 (prod) execution
// path: SSH to a remote box and `docker run` the prebuilt migrate
// image from GHCR.
type RemoteConfig struct {
	// SSH executor — typically a *internal/ssh.Client.
	SSH RemoteSSH

	// Hetzner IPv4 (or any reachable host).
	Host string

	// Docker image, including registry + tag, e.g.
	// "ghcr.io/eduvhc/migrate:latest".
	Image string

	// Docker network on the box the migrate container joins. Same
	// network the app container sees so the postgres DNS name resolves.
	Network string

	// Pre-composed DB URL (with password) the migrator will read. The
	// Stage 3 caller resolves this from the per-product tofu output
	// referenced by Spec.TofuOutputDBURL.
	DatabaseURL string

	// Optional GHCR Personal Access Token. When set, RemoteRun logs in
	// before the pull (kept best-effort — a cached image works without).
	GHCRToken string

	// GHCR owner / namespace for the docker login. Defaults to "eduvhc".
	GHCROwner string
}

// RemoteRun applies one Spec via SSH + docker. Mirrors LocalRun but on
// a remote host. Caller is responsible for resolving Image, Network,
// and DatabaseURL from whatever source they have (tofu outputs, env,
// constants).
func RemoteRun(ctx context.Context, s Spec, cfg RemoteConfig) error {
	if cfg.SSH == nil {
		return fmt.Errorf("migrate.RemoteRun: SSH is required")
	}
	if cfg.Host == "" {
		return fmt.Errorf("migrate.RemoteRun: Host is required")
	}
	if cfg.Image == "" {
		return fmt.Errorf("migrate.RemoteRun: Image is required")
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("migrate.RemoteRun: DatabaseURL is required")
	}
	network := cfg.Network
	if network == "" {
		network = "iedora"
	}
	owner := cfg.GHCROwner
	if owner == "" {
		owner = "eduvhc"
	}

	// docker login — best-effort. Stream token via stdin so it never
	// surfaces in `docker history` / `ps` on the box.
	if cfg.GHCRToken != "" {
		fmt.Fprintf(os.Stderr, "→ migrate[%s]: docker login ghcr.io\n", s.Name)
		loginCmd := fmt.Sprintf(
			"echo %s | docker login ghcr.io -u %s --password-stdin",
			shellQuote(cfg.GHCRToken), shellQuote(owner),
		)
		if err := cfg.SSH.Exec(ctx, cfg.Host, loginCmd); err != nil {
			fmt.Fprintf(os.Stderr, "  ! docker login failed (continuing — image may be cached): %v\n", err)
		}
	}

	fmt.Fprintf(os.Stderr, "→ migrate[%s]: pull %s\n", s.Name, cfg.Image)
	if err := cfg.SSH.Exec(ctx, cfg.Host, "docker pull "+cfg.Image); err != nil {
		// Pull failure is non-fatal IF the image is cached; the
		// subsequent run will fail loud if it truly isn't there.
		fmt.Fprintf(os.Stderr, "  ! pull failed (continuing — using cached if present): %v\n", err)
	}

	fmt.Fprintf(os.Stderr, "→ migrate[%s]: docker run %s\n", s.Name, s.ScriptPath)
	dockerCmd := fmt.Sprintf(
		"docker run --rm --network %s -e %s %s %s",
		shellQuote(network),
		shellQuote(s.URLEnv+"="+cfg.DatabaseURL),
		shellQuote(cfg.Image),
		shellQuote(s.ScriptPath),
	)
	if err := cfg.SSH.Exec(ctx, cfg.Host, dockerCmd); err != nil {
		return fmt.Errorf("migrate run: %w", err)
	}

	fmt.Fprintf(os.Stderr, "✓ migrate[%s] complete\n", s.Name)
	return nil
}

// shellQuote wraps an arg in single quotes for safe SSH transport
// (remote shell re-parses the string). Single quotes preserve every
// char except '; we escape ' as '\''.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// AbsMigrationsDir resolves Spec.MigrationsDir to an absolute path
// against the repo root. Useful for the destructive-SQL lint pre-flight.
// Returns the empty string if the spec opts out of gating.
func AbsMigrationsDir(s Spec, repoRoot string) string {
	if s.MigrationsDir == "" {
		return ""
	}
	return filepath.Join(repoRoot, s.MigrationsDir)
}
