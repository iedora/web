// menu-db-migrations — Stage 3 configurator that runs drizzle
// migrations against the menu database.
//
// Why this lives in Stage 3 (not Stage 4): migrations are application
// state of a shared service (postgres), exactly like Zitadel app config
// is application state of the zitadel service. Running them before
// Stage 4 (the menu container deploy) means a bad migration fails
// loudly in the deploy log without crash-looping the live menu.
// Multi-replica future is also unblocked — migrations run once per
// deploy, not once per replica boot.
//
// Implementation: SSH to the box, run `docker run --rm` against
// `ghcr.io/<owner>/menu:<sha>` invoking the existing `node scripts/
// migrate.mjs`. The migrate script holds a `pg_advisory_lock(727072073)`
// for concurrent-deploy safety, but the lock is single-writer at the
// configurator layer anyway (only one Stage 3 runs at a time per
// `concurrency:` group in CI; the operator runs one at a time locally).
//
// Inputs (env):
//
//	MENU_IMAGE_SHA            image tag to run migrations from. Default "latest".
//	GHCR_OWNER                GHCR namespace (e.g. "eduvhc"). Default "eduvhc".
//	IEDORA_DOCKER_NETWORK     docker network name on the box. Default "iedora".
//	IEDORA_POSTGRES_HOST      DNS name inside the docker network. Default "infra-postgres".
//
// Inputs resolved from Tofu outputs (central root):
//
//	hetzner_ipv4              SSH target.
//	menu_database_url         DATABASE_URL the container sees (postgres+pwd composed).
//
// No BWS reads. Stage 3 env hydration via `bin/with-secrets --stage app`
// doesn't include postgres password (it's iac-scoped); we get the
// composed URL via Tofu output, which works because the operator's
// shell still has BWS_ACCESS_TOKEN, the wrapper still hydrates the iac
// env when fetching tofu outputs at the boundary.
//
// Actually — since this binary runs UNDER `bin/with-secrets --stage app`,
// it only sees app-scope env. To call `tofu output`, it shells out to
// `bin/with-secrets --stage iac -- tofu output -raw ...`. Cheap nested
// invocation: bws-list cache, no extra credential round-trip.
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "menu-db-migrations: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	sha := envOr("MENU_IMAGE_SHA", "latest")
	owner := envOr("GHCR_OWNER", "eduvhc")
	network := envOr("IEDORA_DOCKER_NETWORK", "iedora")

	host, err := tofuOutput(ctx, "hetzner_ipv4")
	if err != nil {
		return fmt.Errorf("read hetzner_ipv4: %w", err)
	}
	if host == "" {
		return fmt.Errorf("hetzner_ipv4 empty — has `task infra:up` run?")
	}

	dbURL, err := tofuOutput(ctx, "menu_database_url")
	if err != nil {
		return fmt.Errorf("read menu_database_url: %w", err)
	}
	if dbURL == "" {
		return fmt.Errorf("menu_database_url empty — likely a Tofu schema drift")
	}

	image := fmt.Sprintf("ghcr.io/%s/menu:%s", owner, sha)

	// `docker login` once before pulling. The kreuzwerker/docker provider's
	// `registry_auth` only applies to Tofu-managed `docker_image` resources;
	// ad-hoc `ssh + docker pull` doesn't inherit those creds. Cheap to
	// re-login every run (Docker dedupes on the saved token in
	// /root/.docker/config.json).
	if ghcrToken := os.Getenv("IAC_BOOTSTRAP_GHCR_TOKEN"); ghcrToken != "" {
		fmt.Fprintln(os.Stderr, "→ menu-db-migrations: docker login ghcr.io")
		// Stream the token via stdin (`--password-stdin`) so it never
		// shows up in `docker history` / process listings on the box.
		loginCmd := fmt.Sprintf(
			"echo %s | docker login ghcr.io -u %s --password-stdin",
			shellQuote(ghcrToken), shellQuote(owner),
		)
		if err := sshExec(ctx, host, loginCmd); err != nil {
			fmt.Fprintf(os.Stderr, "  ! docker login failed (continuing — image may be cached): %v\n", err)
		}
	}

	fmt.Fprintf(os.Stderr, "→ menu-db-migrations: pull %s (skipped if already cached)\n", image)
	if err := sshExec(ctx, host, "docker pull "+image); err != nil {
		// Pull failure is non-fatal IF the image is already on the box
		// (offline rerun, registry blip). The subsequent `docker run`
		// will fail loud and clear if the image truly isn't there.
		fmt.Fprintf(os.Stderr, "  ! pull failed (continuing — using cached if present): %v\n", err)
	}

	// Run the one-shot migrator. `--rm` so a failed migration doesn't
	// leave a stopped container clogging the box. `--network` matches
	// what the menu container sees so DATABASE_URL's `infra-postgres`
	// DNS resolves. Env passed via `-e` is operator-readable in `docker
	// inspect` for ~seconds (until --rm cleans up); fine for a deploy
	// step, not appropriate for a long-running container.
	fmt.Fprintln(os.Stderr, "→ menu-db-migrations: docker run --rm node scripts/migrate.mjs")
	dockerCmd := fmt.Sprintf(
		"docker run --rm --network %s -e %s %s node scripts/migrate.mjs",
		shellQuote(network),
		shellQuote("DATABASE_URL="+dbURL),
		shellQuote(image),
	)
	if err := sshExec(ctx, host, dockerCmd); err != nil {
		return fmt.Errorf("migrate run: %w", err)
	}

	fmt.Fprintln(os.Stderr, "✓ menu-db-migrations complete")
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// tofuOutput shells out to `bin/with-secrets --stage iac -- tofu output
// -raw <name>` against `infra/tofu/`. We re-enter the iac stage rather
// than reading state directly because state is encrypted — only the
// with-secrets wrapper has the passphrase.
func tofuOutput(ctx context.Context, name string) (string, error) {
	infra := infraDir()
	withSecrets := filepath.Join(infra, "bin", "with-secrets")
	cmd := exec.CommandContext(ctx, withSecrets, "--stage", "iac", "--",
		"tofu", "-chdir="+filepath.Join(infra, "tofu"), "output", "-raw", name)
	cmd.Env = os.Environ()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tofu output %s: %w (%s)", name, err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// infraDir resolves the absolute path of the `infra/` directory using
// the same heuristic as cmd/iedora/paths.go. Honors INFRA_DIR env.
func infraDir() string {
	if d := os.Getenv("INFRA_DIR"); d != "" {
		return d
	}
	if cwd, err := os.Getwd(); err == nil {
		for _, candidate := range []string{
			cwd,
			filepath.Join(cwd, "infra"),
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

func sshExec(ctx context.Context, host, remoteCmd string) error {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"root@"+host, remoteCmd)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// shellQuote wraps an arg in single quotes for safe SSH transport
// (remote shell re-parses the string). Single quotes preserve every
// char except '; we escape ' as '\''.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
