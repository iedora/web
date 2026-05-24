package main

const (
	// ── Display ───────────────────────────────────────────────────────────

	logPrefix       = "[dev]"
	totalSteps      = 5 // apply path (init + pass1 + wait + zitadel-apply + env compose)
	destroySteps    = 4 // destroy path (tofu destroy + remove containers + remove network/volumes + wipe)
	redactThreshold = 32 // chars before redact() truncates with ellipsis

	// ── File paths (relative to repo root) ───────────────────────────────

	devTofuDirRel    = "infra/dev/tofu"
	menuDirRel       = "products/menu"
	envFileName      = ".env"
	envLocalFileName = ".env.local"

	// FirstInstance writes the Zitadel admin SA key here; the dev
	// orchestrator reads it to authenticate bin/zitadel-apply (the
	// Stage 3 reconciler).
	zitadelSAKeyPathRel = "infra/dev/.zitadel-bootstrap/zitadel-admin-sa.json"

	// bin/zitadel-apply writes its 6 outputs as a JSON file at this
	// path (when invoked with --no-bws --output-file). The dev
	// orchestrator reads it back when composing menu env.
	zitadelOutputsPathRel = "infra/dev/.zitadel-bootstrap/outputs.json"

	// Path to the zitadel-apply shim relative to repo root.
	zitadelApplyBinRel = "infra/bin/zitadel-apply"

	// ── Network endpoints (well-known dev hosts) ─────────────────────────

	zitadelReadyURL = "http://localhost:8080/debug/ready"
	localhostHTTP   = "http://localhost"

	// ── Container names (defined in dev/tofu/main.tf) ────────────────────

	menuContainerName  = "infra-menu-web"
	houseContainerName = "infra-house"

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
