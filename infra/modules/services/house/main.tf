# House — Astro static, busybox httpd. Same module used in dev (builds
# the image locally via docker_image with a `build {}` block) and
# (when adopted) in prod (image pulled from GHCR). Caller decides.

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
  default = "infra-house"
}

variable "network_name" {
  type = string
}

variable "image_id" {
  description = "Image ID to run. Caller produces it via a `docker_image` (either `build {}` for dev, or pull from GHCR for prod)."
  type        = string
}

variable "expose_host_port" {
  description = "Publish 80 on the host. Dev: 3002. Prod (when containerized): null + Caddy reverse-proxies."
  type        = number
  default     = null
}

resource "docker_container" "this" {
  name    = var.container_name
  image   = var.image_id
  restart = "unless-stopped"

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "house"]
  }

  dynamic "ports" {
    for_each = var.expose_host_port == null ? [] : [var.expose_host_port]
    content {
      internal = 80
      external = ports.value
    }
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
