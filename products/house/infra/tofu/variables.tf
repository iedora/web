variable "cloudflare_api_token" {
  description = <<-EOT
    Bootstrap Cloudflare API token. Permissions for this root:
      - Account · Workers Scripts · Edit       (upload + manage script + assets)
      - Account · Account Settings · Read      (zone lookup)
      - Zone · DNS · Edit                       (custom_domain auto-DNS)
      - Zone · Workers Routes · Edit            (custom_domain binding)
    Provide via TF_VAR_cloudflare_api_token (set by bin/with-secrets from
    BWS key IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN). The same BWS token serves every
    iedora product's Tofu root.
  EOT
  type        = string
  sensitive   = true
}

variable "state_passphrase" {
  description = "OpenTofu state/plan encryption passphrase. ≥ 16 chars. TF_VAR_state_passphrase."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "state_passphrase must be at least 16 characters."
  }
}

variable "account_id" {
  description = "Cloudflare account ID. TF_VAR_account_id (32-char hex)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hex string."
  }
}

variable "worker_name" {
  description = "Cloudflare Worker name. Lowercase, kebab-case. Appears in the dashboard + the *.workers.dev sub if ever re-enabled."
  type        = string
  default     = "iedora-com"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.worker_name))
    error_message = "worker_name must be lowercase letters, digits, and hyphens."
  }
}

variable "zone_name" {
  description = "Apex domain. Drives the cloudflare_zone lookup + the custom domain hostname."
  type        = string
  default     = "iedora.com"
}
