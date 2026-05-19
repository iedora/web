variable "cloudflare_api_token" {
  description = "Cloudflare bootstrap token. TF_VAR_cloudflare_api_token (set by bin/with-secrets from INFRA_CLOUDFLARE_API_TOKEN)."
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

variable "backups_bucket_name" {
  description = "Cloudflare R2 bucket name for Postgres dumps. Covers every iedora product's database. Globally unique within your account."
  type        = string
  default     = "iedora-backups"
}

variable "backups_bucket_location" {
  description = "R2 location hint (auto = closest, EUR/EEUR = Europe)."
  type        = string
  default     = "EEUR"
}

variable "observability_bucket_name" {
  description = "Cloudflare R2 bucket name for OpenObserve long-term storage (parquet shards). Hot data stays on local disk; this is the cold tier."
  type        = string
  default     = "iedora-observability"
}

variable "observability_bucket_location" {
  description = "R2 location hint for the observability bucket. Same as backups so co-located with the homelab."
  type        = string
  default     = "EEUR"
}

variable "observability_hostname" {
  description = "Public FQDN for the OpenObserve UI + OTLP ingest endpoint. Internal-feeling but reachable from any product process via OTLP."
  type        = string
  default     = "obs.iedora.com"
}

variable "tailscale_oauth_client_id" {
  description = <<-EOT
    Tailscale BOOTSTRAP OAuth client ID. TF_VAR_tailscale_oauth_client_id
    (set by bin/with-secrets from INFRA_TAILSCALE_OAUTH_CLIENT_ID).
    Created once manually in the Tailscale admin → Settings → OAuth clients.
    Scopes: policy_file (write) + oauth_keys (write).
  EOT
  type        = string
}

variable "tailscale_oauth_client_secret" {
  description = "Tailscale BOOTSTRAP OAuth client secret. TF_VAR_tailscale_oauth_client_secret (set by bin/with-secrets from INFRA_TAILSCALE_OAUTH_CLIENT_SECRET)."
  type        = string
  sensitive   = true
}

# ── GitHub repo config ───────────────────────────────────────────────────────

variable "github_owner" {
  description = "GitHub user/org that owns the repo. TF_VAR_github_owner."
  type        = string
  default     = "eduvhc"
}

variable "github_repo" {
  description = "GitHub repo name. TF_VAR_github_repo."
  type        = string
  default     = "iedora"
}

variable "github_token" {
  description = <<-EOT
    GitHub fine-grained PAT for the provider. TF_VAR_github_token (set by
    bin/with-secrets from INFRA_GITHUB_API_TOKEN). Repo-scoped with:
    Actions r/w, Secrets r/w, Variables r/w, Contents r.
  EOT
  type        = string
  sensitive   = true
}

# Values pushed into the repo's Actions config. Each maps 1:1 to a
# GitHub Actions secret or variable; the source is BWS (for secrets) or a
# default string (for variables that aren't secret).

variable "bws_access_token" {
  description = "BWS machine-account token. TF_VAR_bws_access_token (auto-set by bin/with-secrets — it's literally the env var that unlocked the bws fetch)."
  type        = string
  sensitive   = true
}

variable "bws_project_id" {
  description = "BWS project UUID. TF_VAR_bws_project_id."
  type        = string
}

variable "kamal_ssh_private_key" {
  description = "Private key (multi-line PEM) for root@<ONPREM_HOST>. TF_VAR_kamal_ssh_private_key (set by bin/with-secrets from INFRA_KAMAL_SSH_PRIVATE_KEY)."
  type        = string
  sensitive   = true
}

variable "claude_code_oauth_token" {
  description = "Claude Code Action OAuth token (Pro/Max, minted by `claude setup-token`). TF_VAR_claude_code_oauth_token (set by bin/with-secrets from INFRA_CLAUDE_CODE_OAUTH_TOKEN)."
  type        = string
  sensitive   = true
}

variable "ci_onprem_host" {
  description = "Tailnet hostname (MagicDNS) the GHA runner SSHes to. Differs from local-laptop ONPREM_HOST (which uses LAN IP)."
  type        = string
  default     = "iedora-homelab"
}

variable "menu_public_hostname" {
  description = "Menu's public FQDN (used by CI for the post-deploy smoke check)."
  type        = string
  default     = "menu.iedora.com"
}

variable "genkan_public_hostname" {
  description = "Genkan's public FQDN."
  type        = string
  default     = "genkan.iedora.com"
}
