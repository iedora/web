// Package migrate is the single source of truth for which products
// have Drizzle migrations and how to invoke them.
//
// Two contexts consume it:
//
//   - `bin/iedora migrate` — local dev + CI. Builds the migrate image
//     from infra/migrate/Dockerfile against the local repo, then
//     `docker run --rm` it per product on the dev Postgres.
//
//   - `bin/iedora app apply` (Stage 3) — prod against Hetzner. SSHes
//     to the box, `docker login + pull` from GHCR, then `docker run`
//     the prebuilt image per product. Each Stage 3 entrypoint
//     (infra/app-state/<product>-db-migrations/) is a thin wrapper
//     that picks a Spec by name + supplies the prod execution context
//     (tofu outputs, GHCR token).
//
// Adding a new product = ONE entry in `Specs` below + a corresponding
// products/<p>/scripts/migrate.mjs + a bundle target in
// infra/migrate/Dockerfile + (when shipping to prod) a thin
// infra/app-state/<p>-db-migrations/ wrapper that calls into this
// package's RemoteRun.
package migrate

// Spec describes one product's migration entrypoint. The values that
// vary per product live here; everything else (network name, postgres
// password, exec strategy) is the runner's concern.
type Spec struct {
	// Display name + value used for the --only filter, metric labels,
	// and Stage 3 configurator names.
	Name string

	// In-container entrypoint path the migrate image places the bundle
	// at. See infra/migrate/Dockerfile Stage 2 layout
	// (/migrate/<name>/scripts/migrate.mjs).
	ScriptPath string

	// Env var the migrate.mjs reads to pick up the connection string.
	URLEnv string

	// Postgres DB name. Used both to compose the local URL (dev path)
	// and as a label on the orchestrator-side telemetry. In prod the
	// URL comes whole from a Tofu output (see TofuOutputDBURL).
	DBName string

	// Tofu output key that holds the prod DB URL (with password). The
	// Stage 3 RemoteRun reads this via `tofu output -raw <key>`. Empty
	// means "not deployable yet" — Stage 3 should skip gracefully.
	TofuOutputDBURL string

	// Path under repoRoot to the Drizzle migrations folder, used by
	// the destructive-SQL gate before invoking the migrator. Empty
	// means "no gating" (e.g. core's auth schema isn't gated today).
	MigrationsDir string
}

// Specs — single source of truth. Order matches Stage 3 dependency
// order: core (better-auth tables) before menu (reads core.session) +
// imopush (reads core.session in future).
var Specs = []Spec{
	{
		Name:            "core",
		ScriptPath:      "/migrate/core/scripts/migrate.mjs",
		URLEnv:          "CORE_DATABASE_URL",
		DBName:          "core",
		TofuOutputDBURL: "core_database_url",
		// No gating yet — auth schema is owned by @iedora/auth, which
		// is a workspace package with its own evolution. Add when the
		// audit table lands.
	},
	{
		Name:            "menu",
		ScriptPath:      "/migrate/menu/scripts/migrate.mjs",
		URLEnv:          "MENU_DATABASE_URL",
		DBName:          "menu",
		TofuOutputDBURL: "menu_database_url",
		MigrationsDir:   "products/menu/drizzle",
	},
	{
		Name:       "imopush",
		ScriptPath: "/migrate/imopush/scripts/migrate.mjs",
		URLEnv:     "IMOPUSH_DATABASE_URL",
		DBName:     "imopush",
		// TofuOutputDBURL intentionally empty — imopush isn't a Stage 4
		// deployable yet. When it ships to prod, add the tofu output +
		// fill this in; the Stage 3 imopush-db-migrations wrapper
		// already exists and will start applying.
		MigrationsDir: "products/imopush/drizzle",
	},
}

// ByName returns the Spec matching name, or false.
func ByName(name string) (Spec, bool) {
	for _, s := range Specs {
		if s.Name == name {
			return s, true
		}
	}
	return Spec{}, false
}
