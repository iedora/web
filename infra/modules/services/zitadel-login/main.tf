# Zitadel Login V2 — separate Next.js companion to the main binary.
# Same image as prod; only the API URL + extra_hosts trick differs
# (dev hits the host port-forward to satisfy the ExternalDomain Host
# header check; prod uses the in-cluster hostname directly).

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
  default = "infra-zitadel-login"
}

variable "network_name" {
  type = string
}

variable "image" {
  type    = string
  default = "ghcr.io/zitadel/zitadel-login:v4.15.0"
}

variable "api_url" {
  description = "Where the login UI calls back into the main binary. Dev: http://localhost:8080 (with extra_hosts trick so Host header matches ExternalDomain). Prod: http://infra-zitadel:8080."
  type        = string
}

variable "base_path" {
  type    = string
  default = "/ui/v2/login"
}

variable "bootstrap_path" {
  description = "Same value passed to the zitadel module's bootstrap_path — login-client.pat is read from here."
  type        = string
}

variable "host_entries" {
  description = "Optional extra /etc/hosts entries inside the container. Dev passes `{host=localhost, ip=host-gateway}` so calls to localhost reach the host port-forward (satisfies Zitadel's ExternalDomain Host-header check)."
  type        = list(object({ host = string, ip = string }))
  default     = []
}

variable "expose_host_port" {
  description = "Publish 3000 on the host. Null in prod (Caddy proxies). 3001 in dev so the browser can reach the login UI directly."
  type        = number
  default     = null
}

resource "docker_container" "this" {
  name    = var.container_name
  image   = var.image
  restart = "unless-stopped"

  env = [
    "ZITADEL_API_URL=${var.api_url}",
    "NEXT_PUBLIC_BASE_PATH=${var.base_path}",
    "ZITADEL_SERVICE_USER_TOKEN_FILE=/zitadel-bootstrap/login-client.pat",
    "ZITADEL_TLS_ENABLED=false",
    "EMAIL_VERIFICATION=false",
  ]

  dynamic "host" {
    for_each = var.host_entries
    content {
      host = host.value.host
      ip   = host.value.ip
    }
  }

  networks_advanced {
    name    = var.network_name
    aliases = [var.container_name, "zitadel-login"]
  }

  volumes {
    container_path = "/zitadel-bootstrap"
    host_path      = startswith(var.bootstrap_path, "/") ? var.bootstrap_path : null
    volume_name    = startswith(var.bootstrap_path, "/") ? null : var.bootstrap_path
    read_only      = true
  }

  dynamic "ports" {
    for_each = var.expose_host_port == null ? [] : [var.expose_host_port]
    content {
      internal = 3000
      external = ports.value
    }
  }

  log_opts = {
    max-size = "10m"
  }
}

output "container_name" { value = docker_container.this.name }
