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

# ── Outputs (consumed by infra/cmd/dev to compose menu env) ─────────────────
# Stage 3 (bin/zitadel-apply against localhost:8080) writes Zitadel-side
# values to infra/dev/.zitadel-bootstrap/outputs.json. The dev orchestrator
# composes products/menu/.env + .env.local by merging this JSON with the
# Tofu outputs below — static literals (URLs, S3 endpoint) plus the dev
# postgres password.
#
# Why outputs over inlined locals in the orchestrator: keeps Tofu as the
# single source of truth for any value that lives in Tofu state. The dev
# orchestrator stays a thin composition layer.

output "menu_database_url_container" {
  description = "menu DATABASE_URL when menu runs as a container on the iedora docker network."
  value       = "postgres://postgres:${local.dev_password}@infra-postgres:5432/menu"
  sensitive   = true
}

output "menu_database_url_host" {
  description = "menu DATABASE_URL when menu runs on the host via `bun run dev`."
  value       = "postgresql://postgres:${local.dev_password}@localhost:5432/menu"
  sensitive   = true
}

output "menu_public_url" {
  description = "Public URL the browser hits (host port published by either menu variant)."
  value       = "http://localhost:3000"
}

output "zitadel_issuer_url" {
  description = "OIDC issuer URL for the local Zitadel."
  value       = "http://localhost:8080"
}

output "menu_otel_headers" {
  description = "OTLP Basic-auth header for menu → OpenObserve in dev."
  value       = "Authorization=Basic%20${base64encode("dev@iedora.local:${local.dev_password}")}"
  sensitive   = true
}

output "menu_otel_endpoint_container" {
  description = "OTLP endpoint when menu runs as a container."
  value       = "http://infra-openobserve:5080/api/default"
}

output "menu_otel_endpoint_host" {
  description = "OTLP endpoint when menu runs on the host."
  value       = "http://localhost:5080/api/default"
}

output "menu_s3_endpoint_container" {
  value = "http://infra-localstack:4566"
}

output "menu_s3_endpoint_host" {
  value = "http://localhost:4566"
}

output "menu_s3_public_url" {
  value = "http://localhost:4566/iedora-assets"
}
