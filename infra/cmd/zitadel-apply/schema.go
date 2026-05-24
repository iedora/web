package main

// Canonical names + IDs for every Zitadel resource the binary reconciles.
// One source of truth, mirrored from `infra/tofu/zitadel.tf` at extraction
// time (commit that introduced `zitadel-apply`).
//
// Drift hazard: the role keys MUST match what menu reads off the
// `permissions` / role claims at runtime
// (`products/menu/src/features/auth/{roles,scopes}.ts`). A CI grep-assert
// catches divergence — when adding a scope here, also add it to scopes.ts
// in the SAME commit.

// ── Org + project ────────────────────────────────────────────────────────────

const (
	orgName     = "iedora"
	projectName = "iedora"
)

// ── Project roles ────────────────────────────────────────────────────────────
//
// Naming convention: keys with `:` are atomic permissions, no expansion.
// Keys without `:` are bundles — expansion lives in
// `products/menu/src/features/auth/bundles.ts`, consumed by the Zitadel
// Actions v2 webhook (`menu-permissions` target).

type projectRole struct {
	key         string
	displayName string
	group       string
}

var projectRoles = []projectRole{
	// Cross-product Iedora-staff bundle.
	{key: "iedora-admin", displayName: "Iedora Admin", group: "iedora"},

	// Atomic permissions — `resource:verb`.
	// NOTE: `qr-codes:list` lives in Zitadel today but is missing from
	// `products/menu/src/features/auth/scopes.ts` (drift discovered during
	// extraction). Kept here for compatibility — drop after the scopes file
	// is updated to either include or drop `:list`.
	{key: "qr-codes:read", displayName: "QR codes — read", group: "qr-codes"},
	{key: "qr-codes:write", displayName: "QR codes — create", group: "qr-codes"},
	{key: "qr-codes:update", displayName: "QR codes — bind / unbind", group: "qr-codes"},
	{key: "qr-codes:delete", displayName: "QR codes — delete", group: "qr-codes"},
	{key: "qr-codes:list", displayName: "QR codes — list", group: "qr-codes"},
}

const iedoraAdminRoleKey = "iedora-admin"

// ── Machine user (menu service account) ──────────────────────────────────────

const (
	menuSAUsername    = "menu-sa"
	menuSAName        = "Menu"
	menuSADescription = "Service account menu uses for org provisioning + membership lookups (#20)."
)

// ── OIDC app ─────────────────────────────────────────────────────────────────

const menuAppName = "menu"

// ── Action targets ───────────────────────────────────────────────────────────
//
// REST_CALL targets are synchronous — the response IS consumed by Zitadel
// (used to inject claims at preuserinfo / preaccesstoken). `interruptOnError
// = false` means a slow/down endpoint silently drops the claim rather than
// blocking sign-in; the DAL fails closed on missing scope.

const (
	menuPermissionsTargetName = "menu-permissions"
	menuGrantsTargetName      = "menu-grants"

	menuPermissionsPath = "/api/zitadel/permissions"
	menuGrantsPath      = "/api/zitadel/grants-changed"

	targetTimeout            = "5s"
	targetInterruptOnError   = false
	targetTypeRESTCall       = "REST_CALL"
	targetVersionLatest      = "REST_ASYNC" //nolint:unused // reserved for future async target
)

// menuGrantEvents — the user.grant.* events the menu-grants target subscribes
// to. Mirrors `local.menu_grant_event_types` in zitadel.tf.
var menuGrantEvents = []string{
	"user.grant.added",
	"user.grant.changed",
	"user.grant.cascade.changed",
	"user.grant.removed",
	"user.grant.cascade.removed",
	"user.grant.deactivated",
	"user.grant.reactivated",
}

// menuPermissionsFunctions — the function-execution names the
// menu-permissions target is bound to. `preuserinfo` fires on userinfo
// endpoint hits; `preaccesstoken` fires when an access token is minted
// (both expose the user's grants to the webhook for `permissions`
// claim injection).
var menuPermissionsFunctions = []string{
	"preuserinfo",
	"preaccesstoken",
}

// ── PAT ──────────────────────────────────────────────────────────────────────

// Long-lived menu_sa PAT. 75-year expiry matches the login-client PAT minted
// by FirstInstance; rotation = delete-and-recreate via this binary.
const menuSAPATExpiry = "2099-01-01T00:00:00Z"

// ── BWS output keys ──────────────────────────────────────────────────────────
//
// The 6 outputs this binary writes back to BWS. Stage 4 (`iedora deploy menu`)
// reads them when composing the menu container env. Keep aligned with
// `infra/cmd/with-secrets/env.go` aliases.

const (
	bwsKeyOIDCClientID         = "APP_ZITADEL_MENU_OIDC_CLIENT_ID"
	bwsKeyOIDCClientSecret     = "APP_ZITADEL_MENU_OIDC_CLIENT_SECRET"
	bwsKeyMenuSAToken          = "APP_ZITADEL_MENU_SA_TOKEN"
	bwsKeyPermissionsSigningKey = "APP_ZITADEL_PERMISSIONS_SIGNING_KEY"
	bwsKeyGrantsSigningKey     = "APP_ZITADEL_GRANTS_SIGNING_KEY"
	bwsKeyProjectID            = "APP_ZITADEL_IEDORA_PROJECT_ID"
)

// allBWSKeys is the destroy-time scrub list (also referenced by
// `iedora iac destroy`).
var allBWSKeys = []string{
	bwsKeyOIDCClientID,
	bwsKeyOIDCClientSecret,
	bwsKeyMenuSAToken,
	bwsKeyPermissionsSigningKey,
	bwsKeyGrantsSigningKey,
	bwsKeyProjectID,
}
