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

variable "zitadel_hostname" {
  description = <<-EOT
    Public FQDN for the self-hosted ZITADEL IdP (issue #19). Tunneled from
    the homelab via Cloudflare; cloudflared terminates inside the `kamal`
    network at `http://infra-zitadel:8080`. End users hit
    `https://auth.iedora.com/ui/v2/login`; OIDC clients use it as the issuer.

    NOTE (2026-05-19): the official `zitadel/zitadel` Tofu provider is NOT
    used during the homelab era — Cloudflare's free plan blocks
    `application/grpc` at the edge (no zone-level toggle, Pro+ feature), so
    Zitadel orgs/projects/OIDC apps are managed via the Console UI for now.
    When IPv4 arrives (new ISP or Hetzner), we drop the CF Tunnel for this
    hostname and switch back to declarative TF management.
  EOT
  type        = string
  default     = "auth.iedora.com"

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.zitadel_hostname))
    error_message = "zitadel_hostname must be a valid FQDN."
  }
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

variable "menu_public_hostname" {
  description = "Public FQDN for the menu app — used as Better Auth's BETTER_AUTH_URL, the A record name, and the Caddyfile site label."
  type        = string
  default     = "menu.iedora.com"
}

# ── Hetzner Cloud ────────────────────────────────────────────────────────────

variable "infra_hcloud_token" {
  description = <<-EOT
    Hetzner Cloud project API token. TF_VAR_infra_hcloud_token (from BWS
    INFRA_HCLOUD_TOKEN). Generated once at
    https://console.hetzner.cloud/projects/<id>/security/tokens — pick
    Read & Write scope. Project-scoped, so a leaked token can only touch
    the iedora project (no account-wide impact).
  EOT
  type        = string
  sensitive   = true
}

variable "hetzner_server_type" {
  description = <<-EOT
    Hetzner SKU for the infra VPS. CAX11 (ARM, 2 vCPU / 4 GB / 40 GB) covers
    the current workload with headroom. Scale to CAX21 (4/8) for Phase 4
    multi-tenant ramp — Hetzner resizes in place without destroy/recreate.
  EOT
  type        = string
  default     = "cax11"

  validation {
    condition     = contains(["cax11", "cax21", "cax31", "cax41"], var.hetzner_server_type)
    error_message = "Use one of the ARM CAX SKUs (cheapest line). Intel/AMD options exist but cost more for the same RAM."
  }
}

variable "hetzner_location" {
  description = <<-EOT
    Hetzner datacenter. fsn1 (Falkenstein, DE) and nbg1 (Nuremberg, DE) both
    sit on the EU backbone — ~40-50ms RTT from Portugal. hel1 (Helsinki, FI)
    adds ~30ms. Stick with fsn1 unless DC capacity forces a move.
  EOT
  type        = string
  default     = "fsn1"

  validation {
    condition     = contains(["fsn1", "nbg1", "hel1"], var.hetzner_location)
    error_message = "Only EU CAX-capable datacenters: fsn1, nbg1, hel1."
  }
}

# ── Container secrets (BWS-sourced) ──────────────────────────────────────────
# Tofu inputs that flow into the docker_container env arrays in
# containers.tf. bin/with-secrets exports each as TF_VAR_* from its BWS
# key. (Previously these lived in a Kamal-style .kamal/secrets file; the
# migration to Tofu-managed containers folded them in here.)

variable "infra_postgres_password" {
  description = "Postgres superuser password (shared accessory). TF_VAR_infra_postgres_password (from BWS INFRA_POSTGRES_PASSWORD)."
  type        = string
  sensitive   = true
}

variable "infra_backup_passphrase" {
  description = "GPG passphrase the backups container uses to encrypt Postgres dumps before R2 upload. TF_VAR_infra_backup_passphrase (from BWS INFRA_BACKUP_PASSPHRASE)."
  type        = string
  sensitive   = true
}

variable "infra_ghcr_token" {
  description = <<-EOT
    Classic GitHub PAT (write:packages) used to pull `ghcr.io/eduvhc/iedora-backup`
    from the homelab. TF_VAR_infra_ghcr_token (from BWS INFRA_GHCR_TOKEN).
    Only needed because the self-built backup image is private; everything
    else (postgres, openobserve, zitadel, cloudflared) is on public registries.
  EOT
  type        = string
  sensitive   = true
}

variable "infra_openobserve_root_user_email" {
  description = "OpenObserve root login email. TF_VAR_infra_openobserve_root_user_email (from BWS INFRA_OPENOBSERVE_ROOT_USER_EMAIL)."
  type        = string
  sensitive   = true
}

variable "infra_openobserve_root_user_password" {
  description = "OpenObserve root login password. TF_VAR_infra_openobserve_root_user_password (from BWS INFRA_OPENOBSERVE_ROOT_USER_PASSWORD)."
  type        = string
  sensitive   = true
}

variable "infra_zitadel_masterkey" {
  description = "Zitadel masterkey (exactly 32 chars). TF_VAR_infra_zitadel_masterkey (from BWS INFRA_ZITADEL_MASTERKEY)."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.infra_zitadel_masterkey) == 32
    error_message = "infra_zitadel_masterkey must be EXACTLY 32 chars; Zitadel rejects anything else with `invalid key length`."
  }
}

variable "infra_zitadel_first_admin_password" {
  description = "Bootstrap password for Zitadel's `zitadel-admin` human user. Used only on first init. TF_VAR_infra_zitadel_first_admin_password (from BWS INFRA_ZITADEL_FIRST_ADMIN_PASSWORD)."
  type        = string
  sensitive   = true
}

# ── Menu app secrets (consumed by docker_container.menu_web) ─────────────────
# Menu used to run via Kamal; on 2026-05-20 it moved to a Tofu-managed
# docker_container so the whole stack is one `tofu apply`. These vars wire
# its runtime env from BWS through TF_VAR_*.

variable "menu_auth_secret" {
  description = "Better Auth signing secret for menu. TF_VAR_menu_auth_secret (from BWS MENU_AUTH_SECRET)."
  type        = string
  sensitive   = true
}

variable "menu_oauth_client_id" {
  description = <<-EOT
    OAuth client ID menu uses against the identity provider. Was genkan during
    Phases 1-2; will be Zitadel from Phase 3 onward (issue #19). For now this
    is read but auth flow won't complete (genkan is gone). Pre-customer; OK.
    TF_VAR_menu_oauth_client_id (from BWS MENU_OAUTH_CLIENT_ID).
  EOT
  type        = string
  sensitive   = true
}

variable "menu_oauth_client_secret" {
  description = "OAuth client secret matching `menu_oauth_client_id`. TF_VAR_menu_oauth_client_secret (from BWS MENU_OAUTH_CLIENT_SECRET)."
  type        = string
  sensitive   = true
}

variable "infra_menu_assets_access_key" {
  description = "R2 S3-compatible access key for the menu assets bucket. TF_VAR_infra_menu_assets_access_key (from BWS INFRA_MENU_ASSETS_ACCESS_KEY)."
  type        = string
  sensitive   = true
}

variable "infra_menu_assets_secret_key" {
  description = "R2 S3-compatible secret key for the menu assets bucket. TF_VAR_infra_menu_assets_secret_key (from BWS INFRA_MENU_ASSETS_SECRET_KEY)."
  type        = string
  sensitive   = true
}

variable "infra_menu_assets_endpoint" {
  description = "Public-facing R2 endpoint for menu assets (e.g. https://assets.iedora.com). TF_VAR_infra_menu_assets_endpoint (from BWS INFRA_MENU_ASSETS_ENDPOINT)."
  type        = string
}

variable "infra_menu_assets_bucket" {
  description = "R2 bucket name (typically just `menu`). TF_VAR_infra_menu_assets_bucket (from BWS INFRA_MENU_ASSETS_BUCKET)."
  type        = string
}

variable "infra_openobserve_ingest_header" {
  description = "OTLP HTTP `Authorization` header value for OpenObserve ingest (`Basic <base64>`). TF_VAR_infra_openobserve_ingest_header (from BWS INFRA_OPENOBSERVE_INGEST_HEADER)."
  type        = string
  sensitive   = true
}

variable "infra_zitadel_sa_key_json" {
  description = <<-EOT
    JSON service-account key for Zitadel's `zitadel-admin-sa` machine user
    (IAM_OWNER, minted by FirstInstance and written to /zitadel-bootstrap/
    zitadel-admin-sa.json on the Hetzner box). The `zitadel/zitadel` Tofu
    provider authenticates with it via `jwt_profile_json`.
    TF_VAR_infra_zitadel_sa_key_json (from BWS INFRA_ZITADEL_SA_KEY_JSON;
    populated once by `just infra::zitadel-fetch-sa-key` after first boot).

    Default empty string is the bootstrap window — `infra/tofu/zitadel.tf`
    gates every zitadel_* resource on this being non-empty, so the first
    apply is a no-op for Zitadel TF management. The provider auth code is
    never reached until the second apply lands the resources.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

