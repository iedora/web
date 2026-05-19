# Cloudflare Access in front of `obs.iedora.com` (issue #13).
#
# OpenObserve OSS does not ship OIDC SSO — Enterprise-only feature. Rather
# than license OO Enterprise + deploy Dex just for UI login, we protect the
# observability UI at the edge: Cloudflare Access challenges every visitor
# with an SSO flow against Genkan (via OIDC) and only forwards them to the
# tunnel after they authenticate. OO itself keeps its own root login as
# break-glass.
#
# Architecture:
#
#   visitor                 cloudflare-access            genkan                 obs.iedora.com
#   -------                 -----------------            ------                 --------------
#   GET obs.iedora.com  →   challenge (cookie?)
#                           no → redirect to     →       /api/auth/oauth2/authorize
#                           (CF Access callback)          (Better Auth OAuth provider)
#                                                         user signs in
#                           ← redirect_uri callback ←    bounce w/ code
#                           exchange code →              /api/auth/oauth2/token
#                           ← id_token + access_token ←
#                           set CF Access cookie
#                           forward request   →                                   →  cloudflared
#                                                                                    → kamal-proxy-bypass
#                                                                                    → infra-openobserve:5080
#                                                                                    (OO renders its own login)
#
# Pre-deploy: mint the OAuth client credentials and seed BOTH places:
#   1. BWS:    INFRA_CF_ACCESS_GENKAN_CLIENT_{ID,SECRET}  (Tofu reads here)
#   2. genkan: TRUSTED_CLIENTS row in products/genkan/infra/kamal/.kamal/secrets
#              (so the boot migration upserts the oauth_client row with
#              redirect_uri = https://<team>.cloudflareaccess.com/cdn-cgi/access/callback)

# Genkan's OAuth endpoint base. Conventionally derived from the genkan
# hostname; pulled out for visibility.
locals {
  cf_access_genkan_base  = "https://${var.genkan_public_hostname}"
  cf_access_genkan_auth  = "${local.cf_access_genkan_base}/api/auth/oauth2/authorize"
  cf_access_genkan_token = "${local.cf_access_genkan_base}/api/auth/oauth2/token"
  cf_access_genkan_jwks  = "${local.cf_access_genkan_base}/api/auth/jwks"
  cf_access_callback_url = "https://${var.cf_access_team_domain}.cloudflareaccess.com/cdn-cgi/access/callback"
}

# OIDC IdP definition. CF Access talks to genkan via Better Auth's OAuth
# provider plugin; PKCE on (it's free with Better Auth and protects the
# code exchange even though CF Access also uses client_secret).
resource "cloudflare_zero_trust_access_identity_provider" "genkan" {
  account_id = var.account_id
  name       = "Genkan (iedora)"
  type       = "oidc"

  config = {
    client_id        = var.cf_access_genkan_client_id
    client_secret    = var.cf_access_genkan_client_secret
    auth_url         = local.cf_access_genkan_auth
    token_url        = local.cf_access_genkan_token
    certs_url        = local.cf_access_genkan_jwks
    scopes           = ["openid", "profile", "email"]
    email_claim_name = "email"
    pkce_enabled     = true
  }
}

# The application — the URL CF Access intercepts. `type = "self_hosted"`
# is the value for "I want CF Access to authenticate access to a regular
# HTTP service behind my tunnel". `session_duration` matches OO's own
# session window so the two cookies expire together.
#
# The allow policy is INLINED here rather than living in a separate
# cloudflare_zero_trust_access_policy resource referenced by id. Reason:
# the CF Terraform provider v5 schema marks `id` and `include` as
# mutually exclusive (ExactlyOneOf) — both are technically valid — but
# inlining sidesteps the separate-resource drift management, keeps the
# allow-list in one place, and is the canonical pattern in the provider
# docs. Codex flagged the previous shape ({ id = ... } only) as risky
# on PR #18.
resource "cloudflare_zero_trust_access_application" "observability" {
  account_id       = var.account_id
  name             = "iedora-observability"
  domain           = var.observability_hostname
  type             = "self_hosted"
  session_duration = "8h"
  allowed_idps     = [cloudflare_zero_trust_access_identity_provider.genkan.id]

  policies = [
    {
      name     = "iedora team"
      decision = "allow"
      # One include entry per allowed email. The id_token's `email`
      # claim (set on the IdP resource above) is what CF Access matches
      # against. For a future team growth path, swap to `email_domain`
      # (allow anyone @iedora.com) or a Cloudflare-managed email_list.
      include = [
        for email in var.cf_access_allowed_emails : {
          email = {
            email = email
          }
        }
      ]
    }
  ]
}
