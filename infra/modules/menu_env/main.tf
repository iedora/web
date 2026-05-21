# Single source of truth for the menu app's runtime env shape.
#
# Both prod (`infra/tofu/containers.tf::docker_container.menu_web.env`)
# and dev (`infra/dev/tofu/main.tf::local_file.env`) call this module
# with their context-specific input values. Adding / removing / renaming
# a key happens in ONE place — the map below — and propagates to both
# backends mechanically. Mind-shift between dev and prod: zero.
#
# A third source of truth still exists at the app layer
# (`products/menu/src/shared/env.ts`, Zod schema). Keep this map and
# that schema in lockstep; CI's typecheck catches drift on the app side
# the first time it boots with a mismatched env.
#
# How to add a new env var:
#   1. Add a `variable` below.
#   2. Add the key to the `env_map` local.
#   3. Pass the value from both `module "menu_env" { ... }` blocks
#      (prod containers.tf + dev tofu/main.tf).
#   4. Update `src/shared/env.ts` Zod schema.

terraform {
  required_version = "~> 1.12"
  # No required_providers — module emits only `local` map / list / string
  # outputs, no resources of its own.
}

# ── Inputs — every dynamic value, named after the env key it feeds ───────────

variable "node_env" {
  description = "production in containers, development locally."
  type        = string
  default     = "production"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "menu_public_url" {
  type = string
}

variable "menu_session_secret" {
  type      = string
  sensitive = true
}

variable "zitadel_issuer_url" {
  type = string
}

variable "zitadel_oauth_client_id" {
  type      = string
  sensitive = true
}

variable "zitadel_oauth_client_secret" {
  type      = string
  sensitive = true
}

variable "zitadel_management_token" {
  type      = string
  sensitive = true
}

variable "zitadel_action_signing_key" {
  description = "HMAC signing key for the Zitadel Actions v2 webhook that injects the flat `permissions` claim. Minted by `zitadel_action_target.menu_permissions.signing_key`."
  type        = string
  sensitive   = true
}

variable "iedora_project_id" {
  description = "ID of the iedora Zitadel project (zitadel_project.iedora.id). The Actions v2 webhook uses it as `projectId` when self-healing a missing iedora-admin grant for an admin email on first sign-in."
  type        = string
  default     = ""
}

variable "iedora_admin_emails" {
  description = "Comma-separated emails that should auto-receive `iedora-admin` on first OIDC sign-in. The Actions v2 webhook reads this and POSTs the grant inline when the email matches and the user has no grant yet — closes the gap that null_resource.iedora_admin_grants leaves when the user is auto-provisioned only at first login."
  type        = string
  default     = ""
}

variable "s3_endpoint" {
  type = string
}

variable "s3_region" {
  type = string
}

variable "s3_access_key" {
  type      = string
  sensitive = true
}

variable "s3_secret_key" {
  type      = string
  sensitive = true
}

variable "s3_bucket" {
  type = string
}

variable "s3_public_url" {
  description = "Public base URL of the asset bucket (CF custom domain in prod, LocalStack endpoint locally)."
  type        = string
  default     = ""
}

variable "otel_exporter_otlp_endpoint" {
  description = "OTLP HTTP endpoint. Empty disables export."
  type        = string
  default     = ""
}

variable "otel_exporter_otlp_headers" {
  description = "OTLP Basic-auth header, URL-encoded. Empty in dev once OpenObserve is anonymous."
  type        = string
  default     = ""
}

variable "host_name" {
  description = "Becomes the host.name OTel resource attribute. Blank in dev."
  type        = string
  default     = ""
}

variable "git_sha" {
  description = "Becomes the service.version OTel resource attribute. Blank in dev."
  type        = string
  default     = ""
}

# ── The canonical env map. Every consumer reads from here ────────────────────

locals {
  env_map = {
    NODE_ENV                    = var.node_env
    NEXT_TELEMETRY_DISABLED     = "1"
    DATABASE_URL                = var.database_url
    MENU_PUBLIC_URL             = var.menu_public_url
    MENU_SESSION_SECRET         = var.menu_session_secret
    ZITADEL_ISSUER_URL          = var.zitadel_issuer_url
    ZITADEL_OAUTH_CLIENT_ID     = var.zitadel_oauth_client_id
    ZITADEL_OAUTH_CLIENT_SECRET = var.zitadel_oauth_client_secret
    ZITADEL_MANAGEMENT_TOKEN    = var.zitadel_management_token
    ZITADEL_ACTION_SIGNING_KEY  = var.zitadel_action_signing_key
    IEDORA_PROJECT_ID           = var.iedora_project_id
    IEDORA_ADMIN_EMAILS         = var.iedora_admin_emails
    S3_ENDPOINT                 = var.s3_endpoint
    S3_REGION                   = var.s3_region
    S3_ACCESS_KEY               = var.s3_access_key
    S3_SECRET_KEY               = var.s3_secret_key
    S3_BUCKET                   = var.s3_bucket
    S3_PUBLIC_URL               = var.s3_public_url
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_otlp_endpoint
    OTEL_EXPORTER_OTLP_HEADERS  = var.otel_exporter_otlp_headers
    HOST_NAME                   = var.host_name
    GIT_SHA                     = var.git_sha
  }

  # Keys whose values are random per dev install (Zitadel-minted IDs +
  # random session secret). The committed `products/menu/.env` carries
  # placeholders for these so a fresh clone has a Zod-valid env file
  # (IDE / lint / typecheck green at clone time); `just dev` then writes
  # the real values to `.env.local` which Next loads with higher
  # precedence than `.env`. Add a new dynamic key here when it appears.
  dynamic_keys = toset([
    "MENU_SESSION_SECRET",
    "ZITADEL_OAUTH_CLIENT_ID",
    "ZITADEL_OAUTH_CLIENT_SECRET",
    "ZITADEL_MANAGEMENT_TOKEN",
    "ZITADEL_ACTION_SIGNING_KEY",
  ])

  # Placeholders chosen to satisfy src/shared/env.ts Zod constraints
  # (MENU_SESSION_SECRET requires ≥ 32 chars; the rest need ≥ 1).
  placeholders = {
    MENU_SESSION_SECRET         = "PLACEHOLDER-bun-run-dev-overrides-via-env-local"
    ZITADEL_OAUTH_CLIENT_ID     = "PLACEHOLDER-bun-run-dev-overrides-via-env-local"
    ZITADEL_OAUTH_CLIENT_SECRET = "PLACEHOLDER-bun-run-dev-overrides-via-env-local"
    ZITADEL_MANAGEMENT_TOKEN    = "PLACEHOLDER-bun-run-dev-overrides-via-env-local"
    ZITADEL_ACTION_SIGNING_KEY  = "PLACEHOLDER-bun-run-dev-overrides-via-env-local"
  }

  env_committable = {
    for k, v in local.env_map :
    k => contains(local.dynamic_keys, k) ? local.placeholders[k] : v
  }
  env_dynamic = {
    for k, v in local.env_map :
    k => v if contains(local.dynamic_keys, k)
  }

  # Stable key order so committed `.env` diffs cleanly across applies.
  env_keys_sorted             = sort(keys(local.env_map))
  env_committable_keys_sorted = sort(keys(local.env_committable))
  env_dynamic_keys_sorted     = sort(keys(local.env_dynamic))
}

# ── Outputs — one shape per consumer ─────────────────────────────────────────

# Prod path: docker_container.env consumes the full list (no .env file,
# values injected directly).
output "env_list" {
  description = "Full env as KEY=value strings — feeds docker_container.env."
  value       = [for k in local.env_keys_sorted : "${k}=${local.env_map[k]}"]
  sensitive   = true
}

# Dev path: two files.
#   `env_committable`  → committed `products/menu/.env`   (statics + placeholders)
#   `env_dynamic`      → gitignored `products/menu/.env.local` (real Zitadel + session)
# Next loads both; `.env.local` overrides `.env` on the dynamic keys.
# The user can also drop their own override into `.env.local` between
# `just dev` runs (TF rewrites the file each run, so manual overrides
# are session-scoped — comment block in the file makes this explicit).
output "env_committable_file" {
  description = "products/menu/.env body — statics + placeholders for the dynamic keys."
  value       = join("\n", [for k in local.env_committable_keys_sorted : "${k}=${local.env_committable[k]}"])
}

output "env_dynamic_file" {
  description = "products/menu/.env.local body — real Zitadel + session values, only the dynamic keys. Printed by dev.go for copy-paste; never auto-written to disk."
  value       = join("\n", [for k in local.env_dynamic_keys_sorted : "${k}=${local.env_dynamic[k]}"])
  sensitive   = true
}
