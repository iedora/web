// core-db-migrations — Stage 3 configurator that runs Drizzle migrations
// against the `core` Postgres database (the @iedora/auth schema:
// user / session / account / organization / member / …).
//
// Why this is its OWN configurator and not folded into menu-db-migrations:
// the menu container boots reading `core.session` rows on every request.
// If menu's container started before core's migrations applied, the
// first request 500s. Running core BEFORE menu's DB migrations + BEFORE
// Stage 4 keeps the order honest, and keeps the rollback story local —
// a bad core migration doesn't crash-loop the live menu.
//
// Implementation: thin wrapper over infra/migrate.RemoteRun via the
// shared infra/app-state/internal/stage3 helper. The spec lives in
// infra/migrate/spec.go::Specs.
package coredbmigrations

import (
	"context"
	"fmt"

	"github.com/eduvhc/iedora/infra/migrate"
	apstate "github.com/eduvhc/iedora/infra/app-state/internal/stage3"
)

// Run is the configurator's entry point. Invoked in-process by iedora's
// app-apply orchestrator (configurators.go).
func Run(ctx context.Context) error {
	spec, ok := migrate.ByName("core")
	if !ok {
		return fmt.Errorf("migrate spec 'core' missing — see infra/migrate/spec.go")
	}
	// No destructive-SQL gate for core today — auth schema is owned by
	// @iedora/auth, which evolves via its own review process. Add when
	// the audit + admin tables land.
	return apstate.RunStage3Migrate(ctx, spec)
}
