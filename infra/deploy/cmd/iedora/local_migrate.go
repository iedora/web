package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// `iedora local migrate` applies every product's Drizzle migrations
// against the local dev Postgres (the `infra-postgres` container the
// dev compose stack stands up).
//
// Mirrors Stage 3 prod migration shape exactly: instead of shelling
// out to host bun, we `docker build` the dedicated migrate image
// (infra/migrate/Dockerfile) and `docker run --rm` it on the `iedora`
// network — the same image, the same entrypoint layout, the same env
// shape as Stage 3 configurators (configurators.go::core-db-migrations
// + menu-db-migrations + future imopush-db-migrations).
//
// Why container-not-host:
//   - One source of truth for the migration runtime. If the prod image
//     can't apply migrations, neither can dev — fail fast in dev.
//   - No host bun / node dependency on the operator. Docker is the
//     only host requirement (already needed for the dev stack anyway).
//   - Catches Dockerfile drift before it lands in CI. Adding a product
//     to the bundle here = adding it to prod, same diff.
//
// Each product owns a `scripts/migrate.mjs` that wraps
// @iedora/db/scripts/run-migrations — ensureDatabase + ensureSchema +
// pg_advisory_lock + programmatic migrate() + OTel spans. The Go
// orchestrator just spawns the right docker invocations in order.
//
// Adding a new product = one entry in localMigrators below + the
// usual products/<p>/scripts/migrate.mjs + an entry in
// infra/migrate/Dockerfile's bundler stage. bin/dev-stack is untouched.

const (
	// migrateImageTag — local-only tag for the dev migrate image. We
	// don't pull from GHCR in dev because (a) we want to test the
	// current branch's Dockerfile, not whatever shipped to main; (b) no
	// network dependency on `bin/dev-stack` happy path. Build is fast
	// (~30s warm, layered caches).
	migrateImageTag = "iedora-migrate:local"

	// devDockerNetwork — name of the docker network the dev compose
	// stack creates (`dev/docker-compose.yml::networks.iedora`). The
	// migrate container joins it so `infra-postgres` resolves.
	devDockerNetwork = "iedora"

	// devPostgresPassword — matches dev/docker-compose.yml. Dev only.
	devPostgresPassword = "Password1!"
)

type localMigrator struct {
	// Display name; used in log lines + --only filter.
	name string
	// In-container entrypoint path the migrate image places the bundle
	// at. See infra/migrate/Dockerfile Stage 2 layout.
	scriptPath string
	// Env var name the migrate script reads to pick up the URL.
	urlEnv string
	// Postgres DB name on the dev infra-postgres accessory. The dev
	// init.sql (infra/iac/postgres/init.sql) creates these on first
	// boot; the migrate script's ensureDatabase covers warm volumes
	// where a product was added later.
	dbName string
}

// localMigrators — single source of truth for which products have
// migrations and which DB each one owns. Order matches Stage 3's
// appConfigurators in configurators.go (core first; products after).
var localMigrators = []localMigrator{
	{
		name:       "core",
		scriptPath: "/migrate/core/scripts/migrate.mjs",
		urlEnv:     "CORE_DATABASE_URL",
		dbName:     "core",
	},
	{
		name:       "menu",
		scriptPath: "/migrate/menu/scripts/migrate.mjs",
		urlEnv:     "MENU_DATABASE_URL",
		dbName:     "menu",
	},
	{
		name:       "imopush",
		scriptPath: "/migrate/imopush/scripts/migrate.mjs",
		urlEnv:     "IMOPUSH_DATABASE_URL",
		dbName:     "imopush",
	},
}

// devDatabaseURL — URL the migrate container uses to reach Postgres.
// `infra-postgres` resolves on the `iedora` docker network only — host
// port 5432 is unused from inside the container.
func devDatabaseURL(dbName string) string {
	return fmt.Sprintf(
		"postgresql://postgres:%s@infra-postgres:5432/%s",
		devPostgresPassword,
		dbName,
	)
}

func runLocalMigrate(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("local migrate", flag.ContinueOnError)
	repoRoot := fs.String("repo", "", "absolute path to the repo root (required)")
	only := fs.String("only", "", "run only one migrator by name (e.g. imopush)")
	skipBuild := fs.Bool("skip-build", false, "reuse a previously-built "+migrateImageTag+" image")
	if err := fs.Parse(argv); err != nil {
		return err
	}
	if *repoRoot == "" {
		fs.Usage()
		return fmt.Errorf("--repo is required")
	}

	abs, err := filepath.Abs(*repoRoot)
	if err != nil {
		return fmt.Errorf("resolve --repo: %w", err)
	}
	if _, err := os.Stat(filepath.Join(abs, "package.json")); err != nil {
		return fmt.Errorf("--repo %q doesn't look like the repo root (no package.json): %w", abs, err)
	}

	if !*skipBuild {
		if err := buildMigrateImage(ctx, abs); err != nil {
			return fmt.Errorf("build migrate image: %w", err)
		}
	}

	for _, m := range localMigrators {
		if *only != "" && *only != m.name {
			continue
		}
		if err := runOneLocalMigrator(ctx, m); err != nil {
			return fmt.Errorf("migrate %s: %w", m.name, err)
		}
	}
	return nil
}

// buildMigrateImage runs `docker build` against infra/migrate/Dockerfile
// with the repo root as build context (the Dockerfile reads packages/,
// products/, package.json, bun.lock, apps/web/package.json from the
// context — same shape CI uses).
//
// Layered cache means warm rebuilds are ~5s (only bun install +
// bun build re-run when source changes). Cold build is ~60s.
func buildMigrateImage(ctx context.Context, repoRoot string) error {
	fmt.Fprintf(os.Stderr, "→ iedora local migrate: docker build %s\n", migrateImageTag)
	cmd := exec.CommandContext(ctx,
		"docker", "build",
		"-f", filepath.Join(repoRoot, "infra/migrate/Dockerfile"),
		"-t", migrateImageTag,
		repoRoot,
	)
	cmd.Stdout = os.Stderr // build chatter on stderr; reserve stdout for migrate output
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runOneLocalMigrator(ctx context.Context, m localMigrator) error {
	fmt.Fprintf(os.Stderr, "→ iedora local migrate: %s (%s)\n", m.name, m.dbName)

	// docker run --rm --network iedora -e <URL_ENV>=... <image> <script>
	cmd := exec.CommandContext(ctx,
		"docker", "run", "--rm",
		"--network", devDockerNetwork,
		"-e", m.urlEnv+"="+devDatabaseURL(m.dbName),
		migrateImageTag,
		m.scriptPath,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
