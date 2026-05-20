# LocalStack — dev-only S3 mock. Mirrors prod's R2 bucket shape:
# pre-creates `iedora-data` + `iedora-assets` via the init.sh hook.
#
# This module exists so dev's TF root can declare the LocalStack
# container declaratively (no compose). Prod doesn't call it — there
# the bucket lives in real R2 (cloudflare_r2_bucket resources).

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
  default = "infra-localstack"
}

variable "network_name" {
  type = string
}

variable "image" {
  type    = string
  default = "localstack/localstack:4"
}

variable "data_volume_name" {
  type = string
}

variable "init_script" {
  description = "Shell script body that LocalStack runs once on first ready hook. Use this to pre-create buckets etc."
  type        = string
}

variable "expose_host_port" {
  type    = number
  default = 4566
}

resource "docker_container" "this" {
  name    = var.container_name
  image   = var.image
  restart = "unless-stopped"

  env = [
    "SERVICES=s3",
    "DEFAULT_REGION=us-east-1",
    "AWS_DEFAULT_REGION=us-east-1",
  ]

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "localstack"]
  }

  volumes {
    container_path = "/var/lib/localstack"
    volume_name    = var.data_volume_name
  }

  # Drop the init script into LocalStack's `ready.d` hook directory.
  # LocalStack runs it once when its services report ready.
  upload {
    file       = "/etc/localstack/init/ready.d/init.sh"
    content    = var.init_script
    executable = true
  }

  ports {
    internal = 4566
    external = var.expose_host_port
  }

  healthcheck {
    test     = ["CMD-SHELL", "curl -fsS http://localhost:4566/_localstack/health | grep -q s3"]
    interval = "10s"
    timeout  = "5s"
    retries  = 5
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
