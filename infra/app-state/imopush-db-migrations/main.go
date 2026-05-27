// imopush-db-migrations — Stage 3 configurator for the `imopush` product.
//
// Currently a no-op: imopush is not yet Stage-4-deployable (no tofu
// output `imopush_database_url`, no Hetzner container). The configurator
// is registered so adding the tofu output is the only flip needed to
// start applying — see migrate.Specs[imopush].TofuOutputDBURL.
//
// Implementation: thin wrapper over infra/migrate.RemoteRun via the
// shared infra/app-state/internal/stage3 helper. The spec lives in
// infra/migrate/spec.go::Specs.
package imopushdbmigrations

import (
	"context"
	"fmt"

	"github.com/eduvhc/iedora/infra/migrate"
	"github.com/eduvhc/iedora/internal/mode"
	apstate "github.com/eduvhc/iedora/infra/app-state/internal/stage3"
)

const runsIn = mode.Live

// Run is the configurator's entry point. Invoked in-process by iedora's
// app-apply orchestrator (configurators.go).
func Run(ctx context.Context) error {
	spec, ok := migrate.ByName("imopush")
	if !ok {
		return fmt.Errorf("migrate spec 'imopush' missing — see infra/migrate/spec.go")
	}

	// Destructive-SQL gate before any network calls (no-op until the
	// spec gets a non-empty TofuOutputDBURL, but ready when it does).
	if dir := migrate.AbsMigrationsDir(spec, apstate.RepoRoot()); dir != "" {
		if err := migrate.GateMigrations(dir, runsIn); err != nil {
			return err
		}
	}

	return apstate.RunStage3Migrate(ctx, spec)
}
