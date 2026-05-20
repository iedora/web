# Postgres — shared service module.

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
  default = "infra-postgres"
}

variable "network_name" {
  description = "Network the container attaches to. The container is registered under both `container_name` and the alias `postgres` for in-network DNS."
  type        = string
}

variable "image" {
  type    = string
  default = "postgres:18.4-alpine"
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "data_path" {
  description = "Host path (`/...`) for bind mount, or docker_volume name for a named volume. Bind in prod (data survives container recreate), named volume in dev (`tofu destroy` cleans)."
  type        = string
}

variable "init_sql" {
  description = "Optional init.sql contents — Postgres runs this on a TRULY empty data dir (first boot only)."
  type        = string
  default     = ""
}

variable "expose_host_port" {
  description = "Publish 5432 on the host? Null in prod (container-only). 5432 in dev so `psql -h localhost` works."
  type        = number
  default     = null
}

locals {
  uses_bind_mount = startswith(var.data_path, "/")
}

resource "docker_container" "this" {
  name    = var.container_name
  image   = var.image
  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=postgres",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=postgres",
  ]

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "postgres"]
  }

  volumes {
    container_path = "/var/lib/postgresql"
    host_path      = local.uses_bind_mount ? var.data_path : null
    volume_name    = local.uses_bind_mount ? null : var.data_path
  }

  dynamic "upload" {
    for_each = var.init_sql == "" ? [] : [1]
    content {
      file    = "/docker-entrypoint-initdb.d/init.sql"
      content = var.init_sql
    }
  }

  dynamic "ports" {
    for_each = var.expose_host_port == null ? [] : [var.expose_host_port]
    content {
      internal = 5432
      external = ports.value
    }
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U postgres"]
    interval = "5s"
    timeout  = "5s"
    retries  = 5
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
output "container_id" { value = docker_container.this.id }
