package main

const (
	// ── Display ───────────────────────────────────────────────────────────

	logPrefix       = "[dev]"
	totalSteps      = 4 // apply path
	destroySteps    = 5 // destroy path (extra state-rm pass for zitadel_*)
	redactThreshold = 32 // chars before redact() truncates with ellipsis

	// ── File paths (relative to repo root) ───────────────────────────────

	devTofuDirRel    = "infra/dev/tofu"
	menuDirRel       = "products/menu"
	envFileName      = ".env"
	envLocalFileName = ".env.local"

	// FirstInstance writes the Zitadel admin SA key here; the second
	// `tofu apply` pass reads it to authenticate the zitadel provider.
	zitadelSAKeyPathRel = "infra/dev/.zitadel-bootstrap/zitadel-admin-sa.json"

	// ── Network endpoints (well-known dev hosts) ─────────────────────────

	zitadelReadyURL = "http://localhost:8080/debug/ready"
	localhostHTTP   = "http://localhost"

	// ── Container names (defined in dev/tofu/main.tf) ────────────────────

	menuContainerName  = "infra-menu-web"
	houseContainerName = "infra-house"

	// ── Tofu output names + TF_VAR names ─────────────────────────────────

	outputEnvCommittable = "env_committable_file"
	outputEnvDynamic     = "env_dynamic_file"

	tfVarZitadelJWT = "TF_VAR_zitadel_jwt_profile"

	// ── .env.local annotation contract ───────────────────────────────────

	// Placeholder for keys with no local backing — operator manually
	// fills with a remote URL (homelab tunnel, etc).
	placeholderValue = "<please_fill>"

	// Lines starting with this prefix are managed by the orchestrator;
	// everything else (user comments, KEY=VALUE) passes through.
	managedNotePrefix = "# auto: "

	// Annotation lifecycle tokens — written out + parsed back in.
	annotationManaged = "managed"
	annotationStale   = "stale"
	annotationAdded   = "added" // legacy pre-Option-2 annotation; parsed as managed

	annotationDate = "2006-01-02" // YYYY-MM-DD (time.Format)

	// ── File modes ───────────────────────────────────────────────────────

	envFileMode      = 0o644 // .env is committed; world-readable is fine
	envLocalFileMode = 0o600 // .env.local has overrides; operator-only
)
