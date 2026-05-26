package main

import (
	"context"
	"fmt"

	menudbmigrations "github.com/eduvhc/iedora/infra/app-state/menu-db-migrations"
	openobservedashboards "github.com/eduvhc/iedora/infra/app-state/openobserve-dashboards"
	zitadelapply "github.com/eduvhc/iedora/infra/app-state/zitadel-apply"
)

// appConfigurator describes one Stage-3 reconciler — a Go package that
// knows how to talk to one running shared service and bring its
// app-level configuration to a declared state.
//
// One configurator per concern. Today: Zitadel, menu DB migrations,
// OpenObserve dashboards. Each lives in its own
// `infra/app-state/<name>/` directory as an importable package; this
// orchestrator calls the package's `Run(ctx)` (or `Run(ctx, argv)`)
// directly. No subprocess fork, no PATH lookup, no env round-trip:
// stage-app env is already in os.Environ from `bws run`.
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
	// registry honest about both nullary configurators and ones that
	// might one day need argv (zitadel-apply already accepts flags
	// for `--grants-only`; the binary wrapper at
	// infra/app-state/cmd/zitadel-apply parses them — here we default
	// to nil for the full-reconcile path).
	run func(ctx context.Context) error
}

// appConfigurators — the registry. Order matters (sequential exec).
// Stage-3 reconcilers run BEFORE Stage 4 (deploy). The menu container
// boots against an already-migrated DB; a bad migration / dashboard /
// Zitadel config fails loudly in the deploy log without crash-looping
// the live menu.
var appConfigurators = []appConfigurator{
	{
		// Org, project, roles, OIDC app, machine user + PAT, action
		// targets, admin grants — see infra/app-state/zitadel-apply/.
		name: "zitadel-app-config",
		run: func(ctx context.Context) error {
			// nil argv → defaults (full reconcile, mode=live).
			return zitadelapply.Run(ctx, nil)
		},
	},
	{
		// drizzle-kit migrate against menu's postgres database. SSHes
		// to the box and `docker run`s migrate.mjs from the menu image
		// at MENU_IMAGE_SHA. See infra/app-state/menu-db-migrations/.
		name: "menu-db-migrations",
		run:  menudbmigrations.Run,
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
