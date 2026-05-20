# OpenObserve — shared. Same image + same shape in dev (S3 backend
# is LocalStack) and prod (S3 backend is Cloudflare R2 under the
# `iedora-data` bucket, prefix `o2/`).

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
  default = "infra-openobserve"
}

variable "network_name" {
  type = string
}

variable "image" {
  type    = string
  default = "public.ecr.aws/zinclabs/openobserve:v0.90.0"
}

variable "data_path" {
  description = "Bind path or named volume for /data (parquet shards' hot tier)."
  type        = string
}

variable "root_user_email" {
  type      = string
  sensitive = true
}

variable "root_user_password" {
  type      = string
  sensitive = true
}

variable "s3" {
  description = "Cold-tier S3 config. Endpoint differs between dev (LocalStack on the same network) and prod (R2). Same access pattern."
  type = object({
    endpoint      = string
    region        = string
    bucket        = string
    bucket_prefix = string
    access_key    = string
    secret_key    = string
  })
}

variable "expose_host_port" {
  description = "Publish 5080 on the host. Null in prod (private; ssh -L to reach). 5080 in dev."
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
    "ZO_DATA_DIR=/data",
    "ZO_HTTP_PORT=5080",
    "ZO_GRPC_PORT=5081",
    "ZO_S3_PROVIDER=aws",
    "ZO_S3_REGION_NAME=${var.s3.region}",
    "ZO_S3_BUCKET_NAME=${var.s3.bucket}",
    "ZO_S3_BUCKET_PREFIX=${var.s3.bucket_prefix}",
    "ZO_S3_SERVER_URL=${var.s3.endpoint}",
    "ZO_S3_FEATURE_FORCE_PATH_STYLE=true",
    "ZO_S3_ACCESS_KEY=${var.s3.access_key}",
    "ZO_S3_SECRET_KEY=${var.s3.secret_key}",
    "ZO_ROOT_USER_EMAIL=${var.root_user_email}",
    "ZO_ROOT_USER_PASSWORD=${var.root_user_password}",
  ]

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "openobserve"]
  }

  volumes {
    container_path = "/data"
    host_path      = local.uses_bind_mount ? var.data_path : null
    volume_name    = local.uses_bind_mount ? null : var.data_path
  }

  dynamic "ports" {
    for_each = var.expose_host_port == null ? [] : [var.expose_host_port]
    content {
      internal = 5080
      external = ports.value
    }
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
