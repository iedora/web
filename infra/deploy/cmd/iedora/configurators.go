package main

import (
	"context"
	"fmt"

	coredbmigrations "github.com/eduvhc/iedora/infra/app-state/core-db-migrations"
	imopushdbmigrations "github.com/eduvhc/iedora/infra/app-state/imopush-db-migrations"
	menudbmigrations "github.com/eduvhc/iedora/infra/app-state/menu-db-migrations"
	openobservedashboards "github.com/eduvhc/iedora/infra/app-state/openobserve-dashboards"
)

// appConfigurator describes one Stage-3 reconciler — a Go package that
// knows how to talk to one running shared service and bring its
// app-level configuration to a declared state.
//
// One configurator per concern. Today: core DB migrations, menu DB
// migrations, OpenObserve dashboards. Each lives in its own
// `infra/app-state/<name>/` directory
// as an importable package; this orchestrator calls the package's
// `Run(ctx)` directly. No subprocess fork, no PATH lookup, no env
// round-trip: stage-app env is already in os.Environ from `bws run`.
//
// Adding a configurator:
//   1. New package under `infra/app-state/<name>/` exporting `Run(ctx) error`.
//   2. Append one entry to `appConfigurators` below.
//   3. Implement idempotency yourself — Stage 3 runs every entry on
//      every deploy.
//
// Order in the slice = execution order. Sequential, not parallel —
// the operator wants legible logs, not interleaved chatter, and
// reconcilers are rarely the bottleneck.
type appConfigurator struct {
	// name — short human label for logs.
	name string

	// run — the configurator's entry point. Closure form keeps the
	// registry honest about both nullary configurators and any future
	// ones that might need argv.
	run func(ctx context.Context) error
}

// appConfigurators — the registry. Order matters (sequential exec).
// Stage-3 reconcilers run BEFORE Stage 4 (deploy). Containers boot
// against an already-migrated DB; a bad migration / dashboard fails
// loudly in the deploy log without crash-looping the live product.
var appConfigurators = []appConfigurator{
	{
		// drizzle-kit migrate against the `core` Postgres database
		// (the @iedora/auth schema: user / session / organization /
		// member / …). Runs FIRST so the web container — which reads
		// `core.session` on every request — boots against a migrated
		// schema. See infra/app-state/core-db-migrations/.
		name: "core-db-migrations",
		run:  coredbmigrations.Run,
	},
	{
		// Drizzle migrations against the `menu` Postgres database.
		// SSHes to the box and `docker run`s the dedicated migrate
		// image (ghcr.io/<owner>/migrate:latest).
		// See infra/app-state/menu-db-migrations/.
		name: "menu-db-migrations",
		run:  menudbmigrations.Run,
	},
	{
		// Drizzle migrations against the `imopush` Postgres database.
		// Currently a no-op (no tofu output `imopush_database_url`,
		// no Hetzner deployable) — flips on when the Stage 4 path
		// for imopush lands. See infra/app-state/imopush-db-migrations/.
		name: "imopush-db-migrations",
		run:  imopushdbmigrations.Run,
	},
	{
		// 3 OpenObserve dashboards (business / technical / correlation)
		// pushed to box-localhost:5080 via an SSH `-L` tunnel. OO is
		// firewall-internal in prod; the container's `expose_host_ip
		// = 127.0.0.1` binding + Hetzner's edge firewall both block
		// public access. JSONs are embedded in the package at compile
		// time. See infra/app-state/openobserve-dashboards/.
		name: "openobserve-dashboards",
		run:  openobservedashboards.Run,
	},
}

// runConfigurator dispatches the configurator's Run closure. All env
// the configurator needs (BWS_*, TF_VAR_*, IAC_*, APP_*) is already in
// os.Environ — `bws run --stage app` hydrated it before
// reaching this orchestrator. No env shuffling here.
func runConfigurator(ctx context.Context, ac appConfigurator) error {
	if ac.run == nil {
		return fmt.Errorf("configurator %q has no Run function", ac.name)
	}
	return ac.run(ctx)
}
