variable "account_id" {
  description = "Cloudflare account ID (32-char hex). Provided by the caller — usually `var.account_id` from the root."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hex string."
  }
}

variable "zone_id" {
  description = "Cloudflare zone ID for the hostname. Provided by the caller — usually `data.cloudflare_zone.this.id` from the root."
  type        = string
}

variable "tunnel_name" {
  description = "Logical name for the tunnel (shown in Cloudflare → Zero Trust → Networks → Tunnels). Pick a stable identifier — the product slug is fine."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]{1,32}$", var.tunnel_name))
    error_message = "tunnel_name must be lowercase, kebab-case, 1-32 chars."
  }
}

variable "public_hostname" {
  description = "Public FQDN visitors hit. Must be a subdomain of a zone the caller's API token can edit."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.public_hostname))
    error_message = "public_hostname must be a valid FQDN."
  }
}

variable "extra_ingress" {
  description = <<-EOT
    Additional ingress rules, inserted BEFORE the catch-all 404. Each entry is
    a map with at least `hostname` + `service` (or `service` alone for a path
    rule). Example: route admin.<host> to a different upstream. Default empty.
  EOT
  type        = list(any)
  default     = []
}
