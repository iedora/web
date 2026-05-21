# Declarative management of the Zitadel IdP (issue #19, Phase 1.5+).
#
# This file is gated by `var.infra_zitadel_sa_key_json` being non-empty.
# Zitadel needs to be bootstrapped FIRST (FirstInstance runs on the
# auth.iedora.com box → mints the zitadel-admin-sa service account →
# writes its JSON key to the shared volume), and THEN the SA key has to
# reach BWS so `with-secrets` can hydrate this var. Until that happens,
# every zitadel_* resource has count=0, so the unconfigured provider is
# never actually called.
#
# Bootstrap sequence (one-shot, per Zitadel instance lifetime):
#   1. `just infra::deploy` → Hetzner up + containers up. FirstInstance
#      writes /zitadel-bootstrap/zitadel-admin-sa.json on the new box.
#   2. `just infra::zitadel-fetch-sa-key` → SSH + cat + upload to BWS.
#   3. `just infra::deploy` again → SA key flows through TF_VAR, count
#      flips to 1, org/project import + land declaratively from here on.
#
# After bootstrap there's no chicken-egg: ALL subsequent applies are
# single-shot. The dance happens exactly once per re-bootstrap, which is
# the same shape as the `INFRA_HCLOUD_TOKEN` one-time push.

provider "zitadel" {
  domain   = var.zitadel_hostname
  port     = "443"
  insecure = false
  # The provider runs `Configure()` at plan time regardless of whether any
  # resource uses it — it's NOT lazy. An empty `jwt_profile_json` makes
  # Configure() fail with "one authentication method must be configured",
  # blocking the entire plan during the bootstrap window. We sidestep that
  # by switching auth methods: during bootstrap we pass a static placeholder
  # `access_token` (any non-empty string satisfies the "one method" check);
  # once the real SA key reaches BWS we flip to `jwt_profile_json`. The
  # placeholder NEVER reaches Zitadel — every zitadel_* resource is gated
  # by `local.zitadel_bootstrapped` (count=0 during bootstrap).
  access_token     = local.zitadel_bootstrapped ? null : "placeholder-never-used"
  jwt_profile_json = local.zitadel_bootstrapped ? var.infra_zitadel_sa_key_json : null
}

locals {
  # All zitadel resources gate on this. Flipping `var.infra_zitadel_sa_key_json`
  # from empty → JSON makes them appear on the next plan as adds (org import +
  # project create). `nonsensitive()` is safe here: we're checking presence,
  # not the SA key's content. Without it, the sensitive bit on the var taints
  # every downstream `for_each`/`count` (TF refuses sensitive map keys).
  zitadel_bootstrapped = nonsensitive(var.infra_zitadel_sa_key_json) != ""
}

# Look up the existing iedora org (created by FirstInstance on first boot)
# by its well-known name so we can import it into state.
data "zitadel_orgs" "iedora" {
  name        = "iedora"
  name_method = "TEXT_QUERY_METHOD_EQUALS"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# Declarative import (OpenTofu 1.6+). Brings the FirstInstance-created
# `iedora` org under state management without running `tofu import`.
# Subsequent applies see no drift and the block is a no-op.
import {
  for_each = local.zitadel_bootstrapped ? toset(["iedora"]) : toset([])
  to       = zitadel_org.iedora
  id       = tolist(data.zitadel_orgs.iedora.ids)[0]
}

# The iedora root org. Houses every project, OIDC app, action target, and
# (Phase 4) every member of every restaurant tenant. Name matches the
# FirstInstance env so the import lines up cleanly.
resource "zitadel_org" "iedora" {
  name       = "iedora"
  is_default = true

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# The iedora project — parent for every menu-side OIDC app.
# `project_role_assertion = true` makes Zitadel include the user's project
# roles in the access token; menu's OIDC client reads them off the
# id_token claims (no userinfo round-trip).
resource "zitadel_project" "iedora" {
  name                   = "iedora"
  org_id                 = zitadel_org.iedora.id
  project_role_assertion = true

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── Project roles ────────────────────────────────────────────────────────────
# Iedora-staff cross-product role. Defined on `zitadel_project.iedora` so any
# OIDC app under that project (menu today, future products tomorrow) sees
# this role on the user's token without further config — the project has
# `project_role_assertion = true`, and every OIDC app under it asserts roles
# on both id_token + access_token.
resource "zitadel_project_role" "iedora_admin" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "iedora-admin"
  display_name = "Iedora Admin"
  group        = "iedora"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── Atomic permission roles ──────────────────────────────────────────────────
# Naming convention: keys with `:` are atomic, no expansion. Keys
# without `:` (e.g. `iedora-admin` above) are bundles — expansion lives
# in `products/menu/src/features/auth/bundles.ts`, consumed by the
# Zitadel Actions v2 webhook (`zitadel_action_target` below).
#
# Add a new atomic permission = new `zitadel_project_role` here +
# referencing the scope key in `scopes.ts`. New bundle = new role
# without `:` + entry in `BUNDLES`. No re-grant needed for existing users.

resource "zitadel_project_role" "qr_codes_read" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:read"
  display_name = "QR codes — read"
  group        = "qr-codes"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

resource "zitadel_project_role" "qr_codes_write" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:write"
  display_name = "QR codes — create"
  group        = "qr-codes"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

resource "zitadel_project_role" "qr_codes_update" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:update"
  display_name = "QR codes — bind / unbind"
  group        = "qr-codes"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

resource "zitadel_project_role" "qr_codes_delete" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:delete"
  display_name = "QR codes — delete"
  group        = "qr-codes"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── Actions v2 — bundle expansion webhook ────────────────────────────────────
# Zitadel POSTs the token-mint event to `menu_permissions_endpoint`. The
# menu webhook (`/api/zitadel/permissions`) returns
# `{ append_claims: [{ key: "permissions", value: [...] }] }`, which
# Zitadel embeds in the id_token + access_token + userinfo. The flat
# scope list is the authoritative input to `requireScope` in menu.
#
# Single source of truth — future iedora products point their own
# Zitadel Targets at this same URL, no duplicate map.
#
# `REST_CALL` is synchronous (response IS consumed by Zitadel); contrast
# REST_WEBHOOK which is fire-and-forget. `interrupt_on_error = false`
# means a slow/down webhook silently drops the `permissions` claim
# rather than blocking sign-in; the DAL fails closed on missing scope.
#
# The `signing_key` is a computed attribute (returned once on create).
# It flows into `module.menu_env.zitadel_action_signing_key` via
# `containers.tf`, which makes it available to the menu container as
# `ZITADEL_ACTION_SIGNING_KEY`. Rotate via `tofu apply -replace=...`.

resource "zitadel_action_target" "menu_permissions" {
  name               = "menu-permissions"
  endpoint           = "https://${var.menu_public_hostname}/api/zitadel/permissions"
  target_type        = "REST_CALL"
  timeout            = "5s"
  interrupt_on_error = false

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

resource "zitadel_action_execution_function" "menu_permissions_userinfo" {
  name       = "preuserinfo"
  target_ids = [zitadel_action_target.menu_permissions.id]

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

resource "zitadel_action_execution_function" "menu_permissions_accesstoken" {
  name       = "preaccesstoken"
  target_ids = [zitadel_action_target.menu_permissions.id]

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── iedora-admin grants ──────────────────────────────────────────────────────
# The zitadel TF provider has no "search user by email" data source, and
# `for_each` rejects apply-time-unknown keys — so the lookup-via-data-
# external + zitadel_user_grant chain isn't viable. Instead we run a
# single Go helper (`infra/cmd/zitadel-grant-iedora-admins`, shimmed at
# `infra/bin/zitadel-grant-iedora-admins`) via a `null_resource`
# `local-exec`: it looks up each email and POSTs the grant, treating
# ALREADY_EXISTS (Zitadel's idempotent-grant response) as success.
#
# Triggers: re-runs whenever `var.iedora_admin_emails` changes or the
# role itself is recreated. Users that haven't signed in yet are skipped
# (no fatal error) — append + re-deploy after they self-provision via OIDC.
#
# Limitation: ADDITIVE only. Removing an email from the var does NOT
# revoke the existing grant — do that via the Zitadel admin UI.

resource "null_resource" "iedora_admin_grants" {
  count = local.zitadel_bootstrapped ? 1 : 0

  triggers = {
    emails  = join(",", var.iedora_admin_emails)
    role_id = zitadel_project_role.iedora_admin.id
  }

  provisioner "local-exec" {
    command = "${path.module}/../bin/zitadel-grant-iedora-admins"
    environment = {
      ZG_HOSTNAME   = var.zitadel_hostname
      ZG_SCHEME     = "https"
      ZG_TOKEN      = zitadel_personal_access_token.menu_sa.token
      ZG_ORG_ID     = zitadel_org.iedora.id
      ZG_PROJECT_ID = zitadel_project.iedora.id
      ZG_ROLE_KEY   = zitadel_project_role.iedora_admin.role_key
      ZG_EMAILS     = jsonencode(var.iedora_admin_emails)
    }
  }
}

# ── Menu OIDC app (#20) ──────────────────────────────────────────────────────
# Confidential web client. Menu's auth slice (openid-client + jose) drives
# the standard auth-code-with-PKCE flow against this app:
#   menu → /oauth/v2/authorize → Zitadel login → /api/auth/callback → menu
#
# Both client_id and client_secret are exposed as sensitive computed
# attributes; piped directly into docker_container.menu_web env in
# containers.tf. No BWS round-trip — producer + consumer share TF state.
#
# Why these specific switches:
#   - app_type WEB + auth_method BASIC: classic confidential OIDC client.
#     PKCE is still required by Zitadel for OAuth 2.1 compliance; the
#     openid-client lib sends code_challenge automatically.
#   - response_types CODE / grant_types AUTHORIZATION_CODE + REFRESH_TOKEN:
#     standard backend-server flow. No implicit, no device.
#   - access_token_type JWT: lets the menu container verify access tokens
#     against the Zitadel JWKS (jose.createRemoteJWKSet) without a
#     server-side introspection round-trip.
#   - all three *_assertion flags TRUE: the id_token + access_token both
#     carry the `urn:zitadel:iam:user:resourceowner:*` claims menu reads
#     to derive the user's home org without a second API call.
#   - login_v2.base_uri: route Zitadel-side login UI through the V2 login
#     container that the FirstInstance step provisioned. Without it the
#     redirect lands on the legacy /ui/login (different container).
resource "zitadel_application_oidc" "menu" {
  org_id     = zitadel_org.iedora.id
  project_id = zitadel_project.iedora.id
  name       = "menu"

  redirect_uris             = ["https://${var.menu_public_hostname}/api/auth/callback"]
  post_logout_redirect_uris = ["https://${var.menu_public_hostname}/"]
  response_types            = ["OIDC_RESPONSE_TYPE_CODE"]
  grant_types               = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"]
  app_type                  = "OIDC_APP_TYPE_WEB"
  auth_method_type          = "OIDC_AUTH_METHOD_TYPE_BASIC"
  version                   = "OIDC_VERSION_1_0"
  access_token_type         = "OIDC_TOKEN_TYPE_JWT"
  dev_mode                  = false

  access_token_role_assertion = true
  id_token_role_assertion     = true
  id_token_userinfo_assertion = true

  login_version {
    login_v2 {
      base_uri = "https://${var.zitadel_hostname}/ui/v2/login"
    }
  }

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── Menu service account ─────────────────────────────────────────────────────
# IAM_OWNER machine user the menu container uses for the small set of
# privileged calls it has to make on the user's behalf — list memberships,
# create an org at first onboarding, add a user as ORG_OWNER. The user's
# own OIDC access token wouldn't carry the right scopes for any of these.
#
# A long-lived Personal Access Token is simpler than a JWT key here: the
# token flows in plaintext as `Authorization: Bearer <pat>` and Zitadel
# treats it as the machine user's access token. JWT keys would add a
# client-credentials grant step at runtime for no security gain (the menu
# container still has a long-lived bearer in env either way).
resource "zitadel_machine_user" "menu_sa" {
  org_id            = zitadel_org.iedora.id
  user_name         = "menu-sa"
  name              = "Menu"
  description       = "Service account menu uses for org provisioning + membership lookups (#20)."
  access_token_type = "ACCESS_TOKEN_TYPE_BEARER"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# IAM-level role grant. Required so menu_sa can call `/admin/v1/orgs`
# (org creation at onboarding) and read memberships across orgs.
# Once orgs scale we can narrow this to ORG-scoped grants per tenant org.
resource "zitadel_instance_member" "menu_sa_iam_owner" {
  user_id = zitadel_machine_user.menu_sa.id
  roles   = ["IAM_OWNER"]

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# Long-lived PAT. 75-year expiry matches the login-client PAT minted by
# FirstInstance; rotation path is `tofu apply -replace=...menu_sa` (which
# also recreates the IAM_OWNER grant — same call).
resource "zitadel_personal_access_token" "menu_sa" {
  org_id          = zitadel_org.iedora.id
  user_id         = zitadel_machine_user.menu_sa.id
  expiration_date = "2099-01-01T00:00:00Z"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

# ── Menu session-cookie encryption key ───────────────────────────────────────
# 32-byte symmetric key for the menu app's session JWE (jose, alg=dir,
# enc=A256GCM). The key is sensitive in state (state is encrypted at rest via
# the pbkdf2/AES-GCM block in versions.tf).
#
# Rotation: `tofu apply -replace=random_password.menu_session_secret`. All
# existing sessions invalidate (cookies become undecryptable) → every user
# bounces through the OIDC dance again. Pre-customer this is a non-event.
resource "random_password" "menu_session_secret" {
  length  = 48 # 48 base64 chars > 32 raw bytes, hashed to 32 in app code
  special = false
}
