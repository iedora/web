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
  required_version = "~> 1.15"
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
  }
}

provider "docker" {
  # macOS: Docker Desktop / OrbStack expose the daemon socket at
  # `unix:///var/run/docker.sock`. Linux: same path. Override via
  # DOCKER_HOST env if your setup differs.
}

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
  count    = var.enable_zitadel ? 1 : 0
  name     = "infra-zitadel-bootstrap-chmod"
  image    = "busybox:1.37"
  command  = ["chmod", "777", "/x"]
  must_run = false
  attach   = true

  volumes {
    container_path = "/x"
    host_path      = abspath("${path.module}/../.zitadel-bootstrap")
  }
}

# ── Services ────────────────────────────────────────────────────────────────

module "postgres" {
  count  = var.enable_postgres ? 1 : 0
  source = "../../modules/services/postgres"

  network_name      = docker_network.iedora.name
  postgres_password = "postgres"
  data_path         = docker_volume.postgres_data.name
  expose_host_port  = 5432
  # Pre-create `zitadel` DB. Menu's own DB is auto-created by its
  # migrate.mjs on first run, same as prod's flow.
  init_sql = "CREATE DATABASE zitadel;\n"
}

module "localstack" {
  count  = var.enable_localstack ? 1 : 0
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
}

module "openobserve" {
  count  = var.enable_openobserve ? 1 : 0
  source = "../../modules/services/openobserve"

  network_name       = docker_network.iedora.name
  data_path          = docker_volume.openobserve_data.name
  root_user_email    = "dev@iedora.local"
  root_user_password = "dev-password"
  expose_host_port   = 5080

  s3 = {
    endpoint      = "http://infra-localstack:4566"
    region        = "us-east-1"
    bucket        = "iedora-data"
    bucket_prefix = "o2"
    access_key    = "test"
    secret_key    = "test"
  }
}

locals {
  bootstrap_host_path = abspath("${path.module}/../.zitadel-bootstrap")
}

module "zitadel" {
  count  = var.enable_zitadel ? 1 : 0
  source = "../../modules/services/zitadel"

  network_name      = docker_network.iedora.name
  masterkey         = var.zitadel_masterkey
  external_domain   = "localhost"
  external_port     = 8080
  external_secure   = false
  login_v2_base_uri = "http://localhost:3001/ui/v2/login"
  postgres_host     = "postgres"
  postgres_password = "postgres"
  admin_password    = var.menu_admin_password
  bootstrap_path    = local.bootstrap_host_path
  expose_host_port  = 8080

  depends_on = [
    module.postgres,
    docker_container.zitadel_bootstrap_chmod,
  ]
}

module "zitadel_login" {
  count  = var.enable_zitadel ? 1 : 0
  source = "../../modules/services/zitadel-login"

  network_name   = docker_network.iedora.name
  api_url        = "http://localhost:8080"
  bootstrap_path = local.bootstrap_host_path
  host_entries = [
    { host = "localhost", ip = "host-gateway" },
  ]
  expose_host_port = 3001

  depends_on = [module.zitadel]
}

# ── House (built locally) ────────────────────────────────────────────────────

resource "docker_image" "house" {
  count = var.enable_house ? 1 : 0
  name  = "iedora-house:dev"
  build {
    context    = abspath("${path.module}/../../..")
    dockerfile = "products/house/Dockerfile"
  }
}

module "house" {
  count  = var.enable_house ? 1 : 0
  source = "../../modules/services/house"

  network_name     = docker_network.iedora.name
  image_id         = docker_image.house[0].image_id
  expose_host_port = 3002
}

# ── Zitadel seed (project + OIDC app + menu env files) ──────────────────────
# Two-phase: the first `tofu apply` runs with zitadel_pat="" — just
# brings the containers up. FirstInstance writes the PAT to the
# bind-mount, dev.go reads it, and the second `tofu apply` runs with
# the real PAT set, which gates these resources via
# `local.seed_active`. Idempotent.

variable "zitadel_pat" {
  description = "PAT for the menu-sa machine user. dev.go captures it from infra/dev/.zitadel-bootstrap/menu-sa.pat after the first apply. Pass empty on the first apply."
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  # `nonsensitive` is safe here — we're only checking PRESENCE (length
  # > 0), not the PAT itself. Without this, every for_each / count
  # gating on `seed_active` would taint as sensitive.
  seed_active = var.enable_zitadel && nonsensitive(length(var.zitadel_pat)) > 0
}

provider "zitadel" {
  domain       = "localhost"
  port         = "8080"
  insecure     = true
  access_token = local.seed_active ? var.zitadel_pat : "placeholder-never-used"
}

data "zitadel_orgs" "iedora" {
  count       = local.seed_active ? 1 : 0
  name        = "iedora"
  name_method = "TEXT_QUERY_METHOD_EQUALS"
}

import {
  for_each = local.seed_active ? toset(["iedora"]) : toset([])
  to       = zitadel_org.iedora[0]
  id       = tolist(data.zitadel_orgs.iedora[0].ids)[0]
}

resource "zitadel_org" "iedora" {
  count      = local.seed_active ? 1 : 0
  name       = "iedora"
  is_default = true
}

resource "zitadel_project" "iedora" {
  count                  = local.seed_active ? 1 : 0
  name                   = "iedora"
  org_id                 = zitadel_org.iedora[0].id
  project_role_assertion = true
}

resource "zitadel_application_oidc" "menu" {
  count      = local.seed_active ? 1 : 0
  org_id     = zitadel_org.iedora[0].id
  project_id = zitadel_project.iedora[0].id
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
}

resource "random_password" "menu_session_secret" {
  count   = local.seed_active ? 1 : 0
  length  = 48
  special = false
}

module "menu_env" {
  count  = local.seed_active ? 1 : 0
  source = "../../modules/menu_env"

  node_env        = "development"
  database_url    = "postgresql://postgres:postgres@localhost:5432/menu"
  menu_public_url = "http://localhost:3000"

  menu_session_secret         = random_password.menu_session_secret[0].result
  zitadel_issuer_url          = "http://localhost:8080"
  zitadel_oauth_client_id     = zitadel_application_oidc.menu[0].client_id
  zitadel_oauth_client_secret = zitadel_application_oidc.menu[0].client_secret
  zitadel_management_token    = var.zitadel_pat

  s3_endpoint   = "http://localhost:4566"
  s3_region     = "us-east-1"
  s3_access_key = "test"
  s3_secret_key = "test"
  s3_bucket     = "iedora-assets"
  s3_public_url = "http://localhost:4566/iedora-assets"

  otel_exporter_otlp_endpoint = "http://localhost:5080/api/default"
  otel_exporter_otlp_headers  = "Authorization=Basic%20${base64encode("dev@iedora.local:dev-password")}"
}

output "env_committable_file" {
  description = "Body of products/menu/.env. Empty before the seed runs (first apply)."
  value       = local.seed_active ? module.menu_env[0].env_committable_file : ""
  sensitive   = true
}

output "env_dynamic_file" {
  description = "Real values for the dynamic keys — printed by dev.go for copy-paste into products/menu/.env.local. Empty before the seed runs."
  value       = local.seed_active ? module.menu_env[0].env_dynamic_file : ""
  sensitive   = true
}

output "env_dynamic_keys" {
  description = "Sorted list of dynamic key names. dev.go uses this to schema-sync .env.local."
  value       = local.seed_active ? module.menu_env[0].env_dynamic_keys : []
}
