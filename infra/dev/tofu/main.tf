# Dev TF root — single orchestrator for everything that runs locally.
# Replaces the docker-compose pattern: same service modules as prod
# (`infra/modules/services/*`), called with dev inputs (local docker
# daemon, host-published ports, LocalStack standing in for R2).
#
# Service selection is gated by `enable_*` input variables. `dev.go`
# sets them based on the user's `--only` / `--except` / `-i` flags.
# Default is everything ON.
#
# Two providers:
#   - docker  → local daemon. Brings up containers.
#   - zitadel → the local Zitadel API once it's healthy. Seeds the
#               project + OIDC app + emits the menu .env files.
# The zitadel provider is gated on enable_zitadel (count=0 disables
# every zitadel_* resource).
#
# State lives next to this file (`terraform.tfstate`, plaintext,
# gitignored). Throwaway — `just dev-down` wipes it.

terraform {
  required_version = "~> 1.12"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.7"
    }
    zitadel = {
      source  = "zitadel/zitadel"
      version = "~> 2.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    # Drives the `null_resource` that local-execs the iedora-admin grant
    # helper. See iedora-admin block below.
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

provider "docker" {}

# ── Toggles — what the user selected ────────────────────────────────────────

variable "enable_postgres" {
  type    = bool
  default = true
}
variable "enable_localstack" {
  type    = bool
  default = true
}
variable "enable_zitadel" {
  type    = bool
  default = true
}
variable "enable_openobserve" {
  type    = bool
  default = true
}
variable "enable_house" {
  type    = bool
  default = true
}
variable "enable_menu" {
  type    = bool
  default = true
}

# Dev knobs that the user might twist between runs.

variable "menu_admin_password" {
  description = "FirstInstance bootstrap password for the human admin. Single-machine literal; no rotation concerns."
  type        = string
  default     = "Password1!"
  sensitive   = true
}

variable "zitadel_masterkey" {
  description = "32-char masterkey. Stable per dev install (rotating it invalidates Zitadel state)."
  type        = string
  default     = "dev-masterkey-32-characters-XXXX"
  sensitive   = true
}

# ── Shared network + volumes ────────────────────────────────────────────────

resource "docker_network" "iedora" {
  name   = "iedora"
  driver = "bridge"
}

resource "docker_volume" "postgres_data" {
  name = "postgres-data"
}

resource "docker_volume" "localstack_data" {
  name = "localstack-data"
}

resource "docker_volume" "openobserve_data" {
  name = "openobserve-data"
}

# Zitadel bootstrap volume holds the FirstInstance-minted PATs.
# Bind-mounted to the host so dev.go can read the menu-sa PAT (passed
# to `tofu apply` as -var zitadel_pat).
resource "docker_container" "zitadel_bootstrap_chmod" {
  name     = "infra-zitadel-bootstrap-chmod"
  image    = "busybox:1.37"
  command  = ["chmod", "777", "/x"]
  must_run = false
  attach   = true

  volumes {
    container_path = "/x"
    host_path      = abspath("${path.module}/../.zitadel-bootstrap")
  }

  lifecycle {
    enabled = var.enable_zitadel
  }
}

# ── Services ────────────────────────────────────────────────────────────────

# Single dev password for every human-typeable credential in the stack:
# postgres, openobserve, the Zitadel bootstrap admin, the OTel basic-auth
# headers. The Zitadel masterkey is excluded (must be exactly 32 chars).
# The random_password.* secrets (session, signing key) are excluded too
# — they're machine-only, never typed.
locals {
  dev_password = "Password1!"
}

module "postgres" {
  source = "../../modules/services/postgres"

  network_name      = docker_network.iedora.name
  postgres_password = local.dev_password
  data_path         = docker_volume.postgres_data.name
  expose_host_port  = 5432
  # Same canonical init.sql prod uses — creates every known product DB
  # (currently `menu` + `zitadel`). Single source of truth.
  init_sql = file("${path.module}/../../postgres/init.sql")

  lifecycle {
    enabled = var.enable_postgres
  }
}

module "localstack" {
  source = "../../modules/services/localstack"

  network_name     = docker_network.iedora.name
  data_volume_name = docker_volume.localstack_data.name
  init_script      = <<-EOT
    #!/usr/bin/env bash
    # Mirror prod's R2 bucket layout: iedora-data (private, backups +
    # OO cold tier) + iedora-assets (public, menu uploads).
    set -euo pipefail
    awslocal s3 mb s3://iedora-data
    awslocal s3 mb s3://iedora-assets
  EOT

  lifecycle {
    enabled = var.enable_localstack
  }
}

module "openobserve" {
  source = "../../modules/services/openobserve"

  network_name       = docker_network.iedora.name
  data_path          = docker_volume.openobserve_data.name
  root_user_email    = "dev@iedora.local"
  root_user_password = local.dev_password
  expose_host_port   = 5080

  s3 = {
    endpoint      = "http://infra-localstack:4566"
    region        = "us-east-1"
    bucket        = "iedora-data"
    bucket_prefix = "o2"
    access_key    = "test"
    secret_key    = "test"
  }

  lifecycle {
    enabled = var.enable_openobserve
  }
}

locals {
  bootstrap_host_path = abspath("${path.module}/../.zitadel-bootstrap")
  repo_root           = abspath("${path.module}/../../..")
}

# ── Image-build change detection ────────────────────────────────────────────
# `docker_image.{menu,house}` with a `build {}` block only run the
# build on FIRST create. Without `triggers`, TF treats the cached
# image (e.g. `iedora-menu:dev`) as fresh on every subsequent apply,
# so a touched source file in products/menu/src/** would go unnoticed
# until you `docker rmi iedora-menu:dev`.
#
# We hash the inputs that actually go into each Dockerfile's build
# context. A touched file → hash changes → triggers map changes →
# docker_image gets REPLACED → fresh `docker build` runs.
#
# Hashing ~100 small files takes <100ms per plan. node_modules,
# .next/, dist/, test-results/ are excluded — they're build outputs
# or regenerated from bun.lock, not inputs to the build.

locals {
  menu_tracked_files = sort(tolist(setunion(
    fileset(local.repo_root, "products/menu/src/**"),
    fileset(local.repo_root, "products/menu/scripts/**"),
    fileset(local.repo_root, "products/menu/public/**"),
    fileset(local.repo_root, "products/menu/drizzle/**"),
    fileset(local.repo_root, "packages/*/src/**"),
    fileset(local.repo_root, "packages/*/package.json"),
    toset([
      "bun.lock",
      "package.json",
      "tsconfig.base.json",
      "products/menu/Dockerfile",
      "products/menu/package.json",
      "products/menu/next.config.ts",
      "products/menu/tsconfig.json",
      "products/menu/tsconfig.build.json",
      "products/menu/instrumentation.ts",
      "products/menu/instrumentation.node.ts",
      "products/menu/drizzle.config.ts",
      "products/menu/postcss.config.mjs",
      # menu's Dockerfile COPYs products/house/package.json to satisfy
      # the workspace glob during `bun install`. Treat it as an input.
      "products/house/package.json",
    ]),
  )))
  menu_source_hash = sha1(join("", [
    for f in local.menu_tracked_files : filesha1("${local.repo_root}/${f}")
  ]))

  house_tracked_files = sort(tolist(setunion(
    fileset(local.repo_root, "products/house/src/**"),
    fileset(local.repo_root, "packages/*/src/**"),
    fileset(local.repo_root, "packages/*/package.json"),
    toset([
      "bun.lock",
      "package.json",
      "tsconfig.base.json",
      "products/house/Dockerfile",
      "products/house/package.json",
      "products/house/astro.config.mjs",
      "products/house/tsconfig.json",
      # house's Dockerfile mirrors menu's — needs menu's package.json
      # for the workspace install.
      "products/menu/package.json",
    ]),
  )))
  house_source_hash = sha1(join("", [
    for f in local.house_tracked_files : filesha1("${local.repo_root}/${f}")
  ]))
}

module "zitadel" {
  source = "../../modules/services/zitadel"

  network_name      = docker_network.iedora.name
  masterkey         = var.zitadel_masterkey
  external_domain   = "localhost"
  external_port     = 8080
  external_secure   = false
  login_v2_base_uri = "http://localhost:3001/ui/v2/login"
  postgres_host     = "postgres"
  postgres_password = local.dev_password
  admin_password    = var.menu_admin_password
  # Dev only — the bootstrap password is a known literal ("Password1!"),
  # and `just dev-down && just dev` wipes state often. Forcing a rotate
  # on every wipe is friction without benefit. Prod keeps the default
  # (true) — never explicitly passed here.
  admin_password_change_required = false
  bootstrap_path                 = local.bootstrap_host_path
  expose_host_port               = 8080

  # Mirror prod: FirstInstance mints a JSON RSA key for the
  # `zitadel-admin-sa` machine user. The TF provider authenticates with
  # it via `jwt_profile_json`. `menu-sa` (the PAT the menu app uses for
  # privileged calls) is created separately by the zitadel_* resources
  # below, exactly like prod's infra/tofu/zitadel.tf.
  machine_username = "zitadel-admin-sa"
  machine_name     = "Terraform"
  machine_key_type = "json"

  depends_on = [
    module.postgres,
    docker_container.zitadel_bootstrap_chmod,
  ]

  lifecycle {
    enabled = var.enable_zitadel
  }
}

module "zitadel_login" {
  source = "../../modules/services/zitadel-login"

  network_name   = docker_network.iedora.name
  api_url        = "http://localhost:8080"
  bootstrap_path = local.bootstrap_host_path
  host_entries = [
    { host = "localhost", ip = "host-gateway" },
  ]
  expose_host_port = 3001

  depends_on = [module.zitadel]

  lifecycle {
    enabled = var.enable_zitadel
  }
}

# ── House (built locally) ────────────────────────────────────────────────────

resource "docker_image" "house" {
  name = "iedora-house:dev"
  build {
    context    = local.repo_root
    dockerfile = "products/house/Dockerfile"
  }
  triggers = {
    source = local.house_source_hash
  }
  # See `docker_image.menu` — same in-use-image-during-replace conflict.
  force_remove = true

  lifecycle {
    enabled = var.enable_house
  }
}

module "house" {
  source = "../../modules/services/house"

  network_name     = docker_network.iedora.name
  image_id         = docker_image.house.image_id
  expose_host_port = 3002

  lifecycle {
    enabled = var.enable_house
  }
}

# ── Zitadel seed (project + OIDC app + menu env files) ──────────────────────
# Two-phase: the first `tofu apply` runs with zitadel_jwt_profile="" —
# just brings the containers up. FirstInstance writes the JSON RSA key
# for `zitadel-admin-sa` to the bind-mount, dev.go reads it, and the
# second `tofu apply` runs with the JSON set (via TF_VAR env to avoid
# shell-escaping the multi-line JSON), which gates these resources via
# `local.seed_active`. Same shape as prod's infra/tofu/zitadel.tf.

variable "zitadel_jwt_profile" {
  description = "JWT-profile JSON for `zitadel-admin-sa`. dev.go captures it from infra/dev/.zitadel-bootstrap/zitadel-admin-sa.json after the first apply. Pass empty on the first apply."
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  # `nonsensitive` is safe here — we're only checking PRESENCE (length
  # > 0), not the JSON's content. Without it, every for_each / count
  # gating on `seed_active` would taint as sensitive.
  seed_active = var.enable_zitadel && nonsensitive(length(var.zitadel_jwt_profile)) > 0
}

provider "zitadel" {
  domain   = "localhost"
  port     = "8080"
  insecure = true
  # Provider.Configure() runs at plan time regardless of resource count.
  # Empty `jwt_profile_json` fails the "one auth method" check. During
  # bootstrap we pass a placeholder access_token (any non-empty string)
  # to satisfy that check; it's never used because every zitadel_*
  # resource gates on `local.seed_active`. Same pattern as prod.
  access_token     = local.seed_active ? null : "placeholder-never-used"
  jwt_profile_json = local.seed_active ? var.zitadel_jwt_profile : null
}

data "zitadel_orgs" "iedora" {
  name        = "iedora"
  name_method = "TEXT_QUERY_METHOD_EQUALS"

  lifecycle {
    enabled = local.seed_active
  }
}

import {
  for_each = local.seed_active ? toset(["iedora"]) : toset([])
  to       = zitadel_org.iedora
  id       = tolist(data.zitadel_orgs.iedora.ids)[0]
}

resource "zitadel_org" "iedora" {
  name       = "iedora"
  is_default = true

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_project" "iedora" {
  name                   = "iedora"
  org_id                 = zitadel_org.iedora.id
  project_role_assertion = true

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_application_oidc" "menu" {
  org_id     = zitadel_org.iedora.id
  project_id = zitadel_project.iedora.id
  name       = "menu"

  redirect_uris             = ["http://localhost:3000/api/auth/callback"]
  post_logout_redirect_uris = ["http://localhost:3000/"]
  response_types            = ["OIDC_RESPONSE_TYPE_CODE"]
  grant_types               = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"]
  app_type                  = "OIDC_APP_TYPE_WEB"
  auth_method_type          = "OIDC_AUTH_METHOD_TYPE_BASIC"
  version                   = "OIDC_VERSION_1_0"
  access_token_type         = "OIDC_TOKEN_TYPE_JWT"
  dev_mode                  = true

  access_token_role_assertion = true
  id_token_role_assertion     = true
  id_token_userinfo_assertion = true

  login_version {
    login_v2 {
      base_uri = "http://localhost:3001/ui/v2/login"
    }
  }

  lifecycle {
    enabled = local.seed_active
  }
}

# ── iedora-admin role + grants ──────────────────────────────────────────────
# Mirrors prod's infra/tofu/zitadel.tf. Declarative cross-product staff role
# defined on the iedora project; grants resolved at plan time by the Go
# helper at infra/cmd/zitadel-lookup-users.
#
# Unresolved emails (user hasn't signed in yet) are silently skipped — they
# land on the next apply after Zitadel auto-provisions the user via OIDC.

variable "iedora_admin_emails" {
  description = <<-EOT
    Emails granted the iedora-admin Zitadel project role on every `just dev`.
    User must have signed in via menu locally at least once before they
    resolve — Zitadel auto-provisions on first OIDC login.
  EOT
  type        = list(string)
  default     = ["dev@iedora.local"]
}

resource "zitadel_project_role" "iedora_admin" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "iedora-admin"
  display_name = "Iedora Admin"
  group        = "iedora"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "null_resource" "iedora_admin_grants" {
  count = local.seed_active ? 1 : 0

  triggers = {
    emails  = join(",", var.iedora_admin_emails)
    role_id = zitadel_project_role.iedora_admin.id
  }

  provisioner "local-exec" {
    command = "${path.module}/../../bin/zitadel-grant"
    environment = {
      # Local Zitadel runs plaintext on :8080 — the helper routes via
      # http:// instead of https://.
      ZG_HOSTNAME   = "localhost:8080"
      ZG_SCHEME     = "http"
      ZG_TOKEN      = zitadel_personal_access_token.menu_sa.token
      ZG_ORG_ID     = zitadel_org.iedora.id
      ZG_PROJECT_ID = zitadel_project.iedora.id
      ZG_ROLE_KEY   = zitadel_project_role.iedora_admin.role_key
      ZG_EMAILS     = jsonencode(var.iedora_admin_emails)
    }
  }
}

# ── Atomic permission roles + Actions v2 webhook (mirrors prod) ──────────────
# See prod's infra/tofu/zitadel.tf for the full rationale.

resource "zitadel_project_role" "qr_codes_read" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:read"
  display_name = "QR codes — read"
  group        = "qr-codes"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_project_role" "qr_codes_write" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:write"
  display_name = "QR codes — create"
  group        = "qr-codes"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_project_role" "qr_codes_update" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:update"
  display_name = "QR codes — bind / unbind"
  group        = "qr-codes"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_project_role" "qr_codes_delete" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:delete"
  display_name = "QR codes — delete"
  group        = "qr-codes"

  lifecycle {
    enabled = local.seed_active
  }
}

# Webhook endpoint. Zitadel runs inside the docker network and reaches
# the host's menu (whether containerised or `bun run dev`) via
# `host.docker.internal:3000`. Matches the common dev workflow
# (host bun dev); when menu runs in container, the host loopback still
# resolves to the menu container's published port.
resource "zitadel_action_target" "menu_permissions" {
  name               = "menu-permissions"
  endpoint           = "http://host.docker.internal:3000/api/zitadel/permissions"
  target_type        = "REST_CALL"
  timeout            = "5s"
  interrupt_on_error = false

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_action_execution_function" "menu_permissions_userinfo" {
  name       = "preuserinfo"
  target_ids = [zitadel_action_target.menu_permissions.id]

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_action_execution_function" "menu_permissions_accesstoken" {
  name       = "preaccesstoken"
  target_ids = [zitadel_action_target.menu_permissions.id]

  lifecycle {
    enabled = local.seed_active
  }
}

# ── Grants-changed event webhook (Phase 2.5) ─────────────────────────────────
# Second action target — fires on `user.grant.*` events so menu can refresh
# the resolved permission set on every active session for the affected user
# WITHOUT waiting for them to re-auth. The existing menu_permissions target
# still handles login-time expansion via preuserinfo/preaccesstoken; this
# target closes the gap for grant changes happening mid-session.
#
# Separate target (not piggybacked on menu_permissions) because the payload
# shape differs — function executions get the auth context, event executions
# get the event envelope. The signing key is per-target; menu reads them as
# two distinct env vars.
resource "zitadel_action_target" "menu_grants" {
  name        = "menu-grants"
  endpoint    = "http://host.docker.internal:3000/api/zitadel/grants-changed"
  target_type = "REST_CALL"
  timeout     = "5s"
  # `false` so a slow / down webhook doesn't block grant writes themselves —
  # menu's session row stays stale at worst, picked up on next login.
  interrupt_on_error = false

  lifecycle {
    enabled = local.seed_active
  }
}

# Every `user.grant.*` event we care about. Listed individually instead of
# `all = true` so the trigger surface is auditable from the TF source.
locals {
  menu_grant_event_types = toset([
    "user.grant.added",
    "user.grant.changed",
    "user.grant.cascade.changed",
    "user.grant.removed",
    "user.grant.cascade.removed",
    "user.grant.deactivated",
    "user.grant.reactivated",
  ])
}

resource "zitadel_action_execution_event" "menu_grants_events" {
  for_each = local.seed_active ? local.menu_grant_event_types : toset([])

  event      = each.value
  target_ids = [zitadel_action_target.menu_grants.id]
}

# Menu service account — same shape as prod's infra/tofu/zitadel.tf.
# The `zitadel-admin-sa` JSON key is for TF-provider auth only; the
# menu app itself runs with a separate PAT under `menu-sa`, scoped
# IAM_OWNER for org provisioning + membership lookups.
resource "zitadel_machine_user" "menu_sa" {
  org_id            = zitadel_org.iedora.id
  user_name         = "menu-sa"
  name              = "Menu"
  description       = "Service account menu uses for org provisioning + membership lookups (#20)."
  access_token_type = "ACCESS_TOKEN_TYPE_BEARER"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_instance_member" "menu_sa_iam_owner" {
  user_id = zitadel_machine_user.menu_sa.id
  roles   = ["IAM_OWNER"]

  lifecycle {
    enabled = local.seed_active
  }
}

resource "zitadel_personal_access_token" "menu_sa" {
  org_id          = zitadel_org.iedora.id
  user_id         = zitadel_machine_user.menu_sa.id
  expiration_date = "2099-01-01T00:00:00Z"

  lifecycle {
    enabled = local.seed_active
  }
}

resource "random_password" "menu_session_secret" {
  length  = 48
  special = false

  lifecycle {
    enabled = local.seed_active
  }
}

# Shared inputs to both menu_env calls — secrets + identifiers that
# don't depend on where menu runs (container vs host).
locals {
  menu_env_shared = local.seed_active ? {
    menu_session_secret         = random_password.menu_session_secret.result
    zitadel_oauth_client_id     = zitadel_application_oidc.menu.client_id
    zitadel_oauth_client_secret = zitadel_application_oidc.menu.client_secret
    zitadel_management_token    = zitadel_personal_access_token.menu_sa.token
    zitadel_action_signing_key  = zitadel_action_target.menu_permissions.signing_key
    zitadel_grants_signing_key  = zitadel_action_target.menu_grants.signing_key
    iedora_project_id           = zitadel_project.iedora.id
    iedora_admin_emails         = join(",", var.iedora_admin_emails)
    s3_region                   = "us-east-1"
    s3_access_key               = "test"
    s3_secret_key               = "test"
    s3_bucket                   = "iedora-assets"
    otel_headers                = "Authorization=Basic%20${base64encode("dev@iedora.local:${local.dev_password}")}"
    # Browser-facing URLs — same in both variants (browser only ever
    # talks to host-published ports).
    menu_public_url    = "http://localhost:3000"
    zitadel_issuer_url = "http://localhost:8080"
    s3_public_url      = "http://localhost:4566/iedora-assets"
    } : {
    menu_session_secret         = ""
    zitadel_oauth_client_id     = ""
    zitadel_oauth_client_secret = ""
    zitadel_management_token    = ""
    zitadel_action_signing_key  = ""
    zitadel_grants_signing_key  = ""
    iedora_project_id           = ""
    iedora_admin_emails         = ""
    s3_region                   = ""
    s3_access_key               = ""
    s3_secret_key               = ""
    s3_bucket                   = ""
    otel_headers                = ""
    menu_public_url             = ""
    zitadel_issuer_url          = ""
    s3_public_url               = ""
  }
}

# Variant 1 — runtime env for the menu container. Uses docker-network
# DNS (`infra-postgres`, `infra-localstack`, `infra-openobserve`) for
# internal calls. Mirrors prod's `module "menu_env"` call shape.
module "menu_env_container" {
  source = "../../modules/menu_env"

  lifecycle {
    enabled = local.seed_active
  }

  node_env                    = "production"
  database_url                = "postgres://postgres:${local.dev_password}@infra-postgres:5432/menu"
  menu_public_url             = local.menu_env_shared.menu_public_url
  menu_session_secret         = local.menu_env_shared.menu_session_secret
  zitadel_issuer_url          = local.menu_env_shared.zitadel_issuer_url
  zitadel_oauth_client_id     = local.menu_env_shared.zitadel_oauth_client_id
  zitadel_oauth_client_secret = local.menu_env_shared.zitadel_oauth_client_secret
  zitadel_management_token    = local.menu_env_shared.zitadel_management_token
  zitadel_action_signing_key  = local.menu_env_shared.zitadel_action_signing_key
  zitadel_grants_signing_key  = local.menu_env_shared.zitadel_grants_signing_key
  iedora_project_id           = local.menu_env_shared.iedora_project_id
  iedora_admin_emails         = local.menu_env_shared.iedora_admin_emails
  s3_endpoint                 = "http://infra-localstack:4566"
  s3_region                   = local.menu_env_shared.s3_region
  s3_access_key               = local.menu_env_shared.s3_access_key
  s3_secret_key               = local.menu_env_shared.s3_secret_key
  s3_bucket                   = local.menu_env_shared.s3_bucket
  s3_public_url               = local.menu_env_shared.s3_public_url
  otel_exporter_otlp_endpoint = "http://infra-openobserve:5080/api/default"
  otel_exporter_otlp_headers  = local.menu_env_shared.otel_headers
}

# Variant 2 — drives products/menu/.env + .env.local for the opt-out
# path: `just dev --except menu` + `cd products/menu && bun run dev`.
# All internal URLs flip to `localhost:<published_port>` because the
# Next dev server runs on the host (outside the docker network).
module "menu_env_host" {
  source = "../../modules/menu_env"

  lifecycle {
    enabled = local.seed_active
  }

  node_env                    = "development"
  database_url                = "postgresql://postgres:${local.dev_password}@localhost:5432/menu"
  menu_public_url             = local.menu_env_shared.menu_public_url
  menu_session_secret         = local.menu_env_shared.menu_session_secret
  zitadel_issuer_url          = local.menu_env_shared.zitadel_issuer_url
  zitadel_oauth_client_id     = local.menu_env_shared.zitadel_oauth_client_id
  zitadel_oauth_client_secret = local.menu_env_shared.zitadel_oauth_client_secret
  zitadel_management_token    = local.menu_env_shared.zitadel_management_token
  zitadel_action_signing_key  = local.menu_env_shared.zitadel_action_signing_key
  zitadel_grants_signing_key  = local.menu_env_shared.zitadel_grants_signing_key
  iedora_project_id           = local.menu_env_shared.iedora_project_id
  iedora_admin_emails         = local.menu_env_shared.iedora_admin_emails
  s3_endpoint                 = "http://localhost:4566"
  s3_region                   = local.menu_env_shared.s3_region
  s3_access_key               = local.menu_env_shared.s3_access_key
  s3_secret_key               = local.menu_env_shared.s3_secret_key
  s3_bucket                   = local.menu_env_shared.s3_bucket
  s3_public_url               = local.menu_env_shared.s3_public_url
  otel_exporter_otlp_endpoint = "http://localhost:5080/api/default"
  otel_exporter_otlp_headers  = local.menu_env_shared.otel_headers
}

# ── Menu container (build local, mirror of prod's docker_container.menu_web) ──

resource "docker_image" "menu" {
  name = "iedora-menu:dev"
  build {
    context    = local.repo_root
    dockerfile = "products/menu/Dockerfile"
  }
  triggers = {
    source = local.menu_source_hash
  }
  # On REPLACE (source hash changed), TF removes the old image after
  # building the new one. Without force_remove the operation collides
  # with `infra-menu-web` still referencing the old image during the
  # brief window before container recreation — docker daemon refuses
  # the removal. Force flag bypasses that gate; the container is then
  # recreated to point at the fresh image_id.
  force_remove = true

  lifecycle {
    enabled = var.enable_menu
  }
}

resource "docker_container" "menu" {
  name    = "infra-menu-web"
  image   = docker_image.menu.image_id
  restart = "unless-stopped"

  # Same command as prod (infra/tofu/containers.tf::docker_container.menu_web):
  # migrate then serve. migrate.mjs is idempotent (pg_advisory_lock).
  command = [
    "sh",
    "-c",
    "node scripts/migrate.mjs && node server.js",
  ]

  env = module.menu_env_container.env_list

  networks_advanced {
    name    = docker_network.iedora.name
    aliases = ["infra-menu-web"]
  }

  # Browser hits localhost:3000.
  ports {
    internal = 3000
    external = 3000
  }

  # ZITADEL_ISSUER_URL is `http://localhost:8080` so that the `iss`
  # claim Zitadel emits matches what browsers see. From inside this
  # container, `localhost` would point at itself; mapping it to the
  # host gateway lets the container reach Zitadel via its published
  # :8080 port. Same trick the zitadel-login container uses.
  host {
    host = "localhost"
    ip   = "host-gateway"
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [
    module.postgres,
    module.zitadel,
  ]

  lifecycle {
    enabled = var.enable_menu && local.seed_active
  }
}

# Outputs feed the .env files written by dev.go (host bun-run-dev path).
output "env_committable_file" {
  description = "Body of products/menu/.env. Empty before the seed runs (first apply)."
  value       = local.seed_active ? module.menu_env_host.env_committable_file : ""
  sensitive   = true
}

output "env_dynamic_file" {
  description = "Real values for the dynamic keys — printed by dev.go for copy-paste into products/menu/.env.local. Empty before the seed runs."
  value       = local.seed_active ? module.menu_env_host.env_dynamic_file : ""
  sensitive   = true
}
