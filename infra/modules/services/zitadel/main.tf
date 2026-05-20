# Zitadel main binary — shared module. FirstInstance env mirrors prod
# (infra/tofu/containers.tf legacy state) with masterkey + admin
# password parameterized. Dev passes literals; prod passes BWS-fed vars.

terraform {
  required_version = "~> 1.12"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.7"
    }
  }
}

variable "container_name" {
  type    = string
  default = "infra-zitadel"
}

variable "network_name" {
  type = string
}

variable "image" {
  type    = string
  default = "ghcr.io/zitadel/zitadel:v4.15.0"
}

variable "masterkey" {
  description = "EXACTLY 32 chars. Encrypts every internal Zitadel secret; loss = ciphertext dead."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.masterkey) == 32
    error_message = "masterkey must be exactly 32 characters."
  }
}

variable "external_domain" {
  description = "auth.iedora.com in prod, localhost in dev. Drives the Host header check + the issuer URL."
  type        = string
}

variable "external_port" {
  type    = number
  default = 8080
}

variable "external_secure" {
  description = "true in prod (https via Caddy), false in dev (plain http)."
  type        = bool
  default     = false
}

variable "login_v2_base_uri" {
  description = "Browser-reachable URL of the v2 login UI. In dev: http://localhost:3001/ui/v2/login. In prod: https://auth.iedora.com/ui/v2/login (Caddy routes /ui/v2/* internally)."
  type        = string
}

variable "postgres_host" {
  type    = string
  default = "postgres"
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "admin_password" {
  description = "Bootstrap human-admin password. FirstInstance sets it; ignored on subsequent boots (Zitadel UI is the source of truth thereafter)."
  type        = string
  sensitive   = true
}

variable "admin_email" {
  type    = string
  default = "dev@iedora.local"
}

variable "machine_username" {
  description = "FirstInstance machine user. Dev: `menu-sa` (used both for TF provider auth + menu's runtime management calls). Prod: `zitadel-admin-sa` (TF-provider only; menu_sa is minted separately via the zitadel provider once the admin SA is in BWS)."
  type        = string
  default     = "menu-sa"
}

variable "machine_name" {
  description = "Display name for the machine user."
  type        = string
  default     = "Menu"
}

variable "machine_key_type" {
  description = "How FirstInstance mints the machine credential. `pat` writes a Personal Access Token (single string). `json` writes an RSA JWT profile JSON (signed assertion). The zitadel TF provider auths with either."
  type        = string
  default     = "pat"

  validation {
    condition     = contains(["pat", "json"], var.machine_key_type)
    error_message = "machine_key_type must be `pat` or `json`."
  }
}

variable "bootstrap_path" {
  description = "Where the FirstInstance-minted credential lands. Bind path (`/...`) for dev so the host can read it; named docker volume otherwise."
  type        = string
}

variable "expose_host_port" {
  description = "Publish 8080 on the host. Null in prod (Caddy reverse-proxies via container network). 8080 in dev."
  type        = number
  default     = null
}

resource "docker_container" "this" {
  name    = var.container_name
  image   = var.image
  restart = "unless-stopped"

  command = [
    "start-from-init",
    "--masterkeyFromEnv",
    "--tlsMode", var.external_secure ? "external" : "disabled",
  ]

  env = concat([
    "ZITADEL_EXTERNALDOMAIN=${var.external_domain}",
    "ZITADEL_EXTERNALPORT=${var.external_port}",
    "ZITADEL_EXTERNALSECURE=${var.external_secure}",
    "ZITADEL_TLS_ENABLED=false",

    "ZITADEL_DATABASE_POSTGRES_HOST=${var.postgres_host}",
    "ZITADEL_DATABASE_POSTGRES_PORT=5432",
    "ZITADEL_DATABASE_POSTGRES_DATABASE=zitadel",
    "ZITADEL_DATABASE_POSTGRES_AWAITINITIALCONN=5m",
    "ZITADEL_DATABASE_POSTGRES_USER_USERNAME=postgres",
    "ZITADEL_DATABASE_POSTGRES_USER_PASSWORD=${var.postgres_password}",
    "ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE=disable",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME=postgres",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD=${var.postgres_password}",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE=disable",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_EXISTINGDATABASE=postgres",

    "ZITADEL_FIRSTINSTANCE_ORG_NAME=iedora",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME=zitadel-admin",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_FIRSTNAME=iedora",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_LASTNAME=Admin",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_ADDRESS=${var.admin_email}",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_VERIFIED=true",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD=${var.admin_password}",

    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_USERNAME=login-client",
    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_NAME=Login Client",
    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_PAT_EXPIRATIONDATE=2099-01-01T00:00:00Z",
    "ZITADEL_FIRSTINSTANCE_LOGINCLIENTPATPATH=/zitadel-bootstrap/login-client.pat",

    # Machine user — FirstInstance grants IAM_OWNER automatically.
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME=${var.machine_username}",
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME=${var.machine_name}",

    "ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=true",
    "ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_BASEURI=${var.login_v2_base_uri}",

    "ZITADEL_MASTERKEY=${var.masterkey}",
    ],
    var.machine_key_type == "pat" ? [
      "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_PAT_EXPIRATIONDATE=2099-01-01T00:00:00Z",
      "ZITADEL_FIRSTINSTANCE_PATPATH=/zitadel-bootstrap/${var.machine_username}.pat",
      ] : [
      # JSON machine key — Type=1 RSA, JSON Web Profile format. Read by
      # the zitadel TF provider via `jwt_profile_json`.
      "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_TYPE=1",
      "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_EXPIRATIONDATE=2099-01-01T00:00:00Z",
      "ZITADEL_FIRSTINSTANCE_MACHINEKEYPATH=/zitadel-bootstrap/${var.machine_username}.json",
  ])

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "zitadel"]
  }

  volumes {
    container_path = "/zitadel-bootstrap"
    host_path      = startswith(var.bootstrap_path, "/") ? var.bootstrap_path : null
    volume_name    = startswith(var.bootstrap_path, "/") ? null : var.bootstrap_path
  }

  dynamic "ports" {
    for_each = var.expose_host_port == null ? [] : [var.expose_host_port]
    content {
      internal = 8080
      external = ports.value
    }
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
