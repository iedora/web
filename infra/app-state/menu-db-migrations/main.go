// menu-db-migrations — Stage 3 configurator that runs Drizzle
// migrations against the `menu` Postgres database.
//
// Why this lives in Stage 3 (not Stage 4): migrations are application
// state of a shared service (postgres) — they reconcile the schema
// independently of any product container. Running them before Stage 4
// (the menu container deploy) means a bad migration fails loudly in
// the deploy log without crash-looping the live menu.
//
// Implementation lives in infra/migrate/: shared Spec registry + the
// RemoteRun helper (SSH + docker login + pull + run). This file is the
// thin wrapper that picks the "menu" spec, resolves the prod execution
// context (Tofu outputs, GHCR token), and calls into the shared runner.
// Adding a third product = a sibling wrapper file + one entry in
// migrate.Specs + one bundle target in infra/migrate/Dockerfile.
//
// Inputs (env, injected by `bws run`):
//
//	GHCR_OWNER                GHCR namespace (e.g. "eduvhc"). Default "eduvhc".
//	IEDORA_DOCKER_NETWORK     docker network on the box. Default "iedora".
//	IAC_BOOTSTRAP_GHCR_TOKEN  docker login token (best-effort; cached pull works without).
//
// Inputs resolved from Tofu outputs (central root):
//
//	hetzner_ipv4              SSH target.
//	menu_database_url         MENU_DATABASE_URL the migrator sees.
package menudbmigrations

import (
	"context"
	"fmt"
	"os"

	"github.com/eduvhc/iedora/infra/migrate"
	"github.com/eduvhc/iedora/internal/mode"
	apstate "github.com/eduvhc/iedora/infra/app-state/internal/stage3"
)

// runsIn pins this binary's deployment topology: Stage 3 against the
// live Hetzner box. Belt-and-suspenders against future mistakes —
// destructive migrations require LiveMode acknowledgement via the
// lint gate.
const runsIn = mode.Live

// Run is the configurator's entry point. Invoked in-process by iedora's
// app-apply orchestrator (configurators.go).
func Run(ctx context.Context) error {
	fmt.Fprintf(os.Stderr, "→ menu-db-migrations: mode=%s\n", runsIn)

	spec, ok := migrate.ByName("menu")
	if !ok {
		return fmt.Errorf("migrate spec 'menu' missing — see infra/migrate/spec.go")
	}

	// Destructive-SQL gate before any network calls. A bad migration
	// here would land in postgres while the OLD menu container is
	// still serving requests — Rule 3 in docs/deploy/README.md.
	if dir := migrate.AbsMigrationsDir(spec, apstate.RepoRoot()); dir != "" {
		if err := migrate.GateMigrations(dir, runsIn); err != nil {
			return err
		}
	}

	return apstate.RunStage3Migrate(ctx, spec)
}
