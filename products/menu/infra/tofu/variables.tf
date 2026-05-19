variable "cloudflare_api_token" {
  description = <<-EOT
    Cloudflare API token. Permissions:
      - Zone · DNS · Edit (scoped to the zone holding var.public_hostname —
        needed for the R2 custom-domain CNAME at assets.<zone>)
      - Account · Account Settings · Read
      - Account · Workers R2 Storage · Edit
      - User · API Tokens · Edit
    Provide via TF_VAR_cloudflare_api_token (set by bin/with-secrets from BWS).
    The house/ product needs `Account · Cloudflare Pages · Edit` in addition.
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

variable "token_name_prefix" {
  description = "Prefix for the scoped R2 API token name (shown in Cloudflare → My Profile → API Tokens). Result: `<prefix>-assets-r2`."
  type        = string
  default     = "menu"
}

variable "public_hostname" {
  description = "FQDN visitors hit for the app (e.g. menu.iedora.com). Used to derive the Cloudflare zone (everything after the first dot), the default assets hostname (`assets.<zone>`), and the CORS allowed origin for browser-direct R2 uploads. The DNS record / TLS for this hostname itself is NOT managed here — it's a direct A record to the Hetzner VPS managed at the repo-root `infra/tofu/`."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.public_hostname))
    error_message = "public_hostname must be a valid FQDN."
  }
}

variable "assets_hostname" {
  description = "FQDN for user-uploaded assets. If unset, derived as `assets.<rest-of-public-hostname>`. Becomes the public-readable custom domain on the R2 assets bucket."
  type        = string
  default     = null
}

variable "assets_bucket_name" {
  description = "Cloudflare R2 bucket name for user-uploaded restaurant assets (logos, banners, item photos). Globally unique within your account."
  type        = string
  default     = "menu-assets"
}

variable "assets_bucket_location" {
  description = "R2 location hint for the assets bucket. EEUR keeps data + edge cache origin in Europe."
  type        = string
  default     = "EEUR"
}
