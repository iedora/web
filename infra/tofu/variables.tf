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

# ── Shared R2 buckets ────────────────────────────────────────────────────────

variable "zone_name" {
  description = "Apex domain. Drives the cloudflare_zone lookup + the assets custom-domain hostname."
  type        = string
  default     = "iedora.com"
}

variable "data_bucket_name" {
  description = "Private R2 bucket for backups + future internal datasets. Prefix per consumer (e.g. pg/, o2/)."
  type        = string
  default     = "iedora-data"
}

variable "data_bucket_location" {
  description = "R2 location hint (auto = closest, EUR/EEUR = Europe)."
  type        = string
  default     = "EEUR"
}

variable "assets_bucket_name" {
  description = "Public R2 bucket for product user-uploaded assets. Each product namespaces under its own prefix."
  type        = string
  default     = "iedora-assets"
}

variable "assets_bucket_location" {
  description = "R2 location hint. Same as data so they co-locate on the same R2 edge."
  type        = string
  default     = "EEUR"
}

variable "assets_hostname" {
  description = "Public FQDN that serves the assets bucket via CF custom domain. Cloudflare provisions the TLS cert + manages the CNAME."
  type        = string
  default     = "assets.iedora.com"
}

variable "zitadel_hostname" {
  description = <<-EOT
    Public FQDN for the self-hosted ZITADEL IdP. Direct A record into the
    Hetzner VPS (grey-cloud, no Cloudflare in path); Caddy terminates TLS
    on the box and proxies into `http://infra-zitadel:8080`. End users
    hit `https://auth.iedora.com/ui/v2/login`; OIDC clients use it as the
    issuer. The official `zitadel/zitadel` Tofu provider works against
    this because gRPC isn't gated by CF — see `infra/tofu/zitadel.tf`.
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

variable "infra_ssh_private_key" {
  description = "Private key (multi-line PEM) for root@<ONPREM_HOST>. TF_VAR_infra_ssh_private_key (set by bin/with-secrets from INFRA_SSH_PRIVATE_KEY)."
  type        = string
  sensitive   = true
}

variable "claude_code_oauth_token" {
  description = "Claude Code Action OAuth token (Pro/Max, minted by `claude setup-token`). TF_VAR_claude_code_oauth_token (set by bin/with-secrets from INFRA_CLAUDE_CODE_OAUTH_TOKEN)."
  type        = string
  sensitive   = true
}

variable "menu_public_hostname" {
  description = "Public FQDN for the menu app — used as MENU_PUBLIC_URL, the A record name, the Caddyfile site label, and the Zitadel OIDC redirect URI base."
  type        = string
  default     = "menu.iedora.com"
}

variable "menu_image_sha" {
  description = <<-EOT
    Image tag for ghcr.io/OWNER/menu — the tag (commit SHA or "latest") the
    docker_image.menu resource pins to. Sources:
      - CI:   .github/workflows/infra-deploy.yml sets TF_VAR_menu_image_sha
              from `inputs.image_sha`. The menu CI dispatches infra-deploy
              with the freshly-built commit SHA after each main push, so
              steady state is per-commit pinned.
      - Local: defaults to "latest"; override for deterministic deploys
               with `TF_VAR_menu_image_sha=<sha> just infra::deploy`.
    Rollback path: `gh workflow run infra-deploy.yml --field image_sha=<old-sha>`.
    The image SHA is not a secret and is deliberately NOT in BWS — workflow
    inputs keep config and secrets separate.
  EOT
  type        = string
  default     = "latest"
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
    Hetzner SKU for the infra VPS. CPX22 (AMD EPYC x86_64, 2 vCPU / 4 GB
    RAM / 80 GB SSD, €7.99/mo) is the default — picked because:
      - Next.js menu image build chokes on ARM (CAX series) under Turbopack
        (some transitive deps' native modules don't ship arm64)
      - Postgres benefits from x86 (better kernel tooling, pg_stat semantics)
      - 80 GB SSD doubles the headroom for Postgres growth pre-customer
    Hetzner discontinued the cheaper CX (Intel shared) line in 2025; CPX
    (AMD EPYC shared) is the new entry tier.

    Scale path (in-place resize within the family):
      cpx22 (current)  2/4GB/80GB   €7.99
      cpx32            4/8GB/160GB  €13.99 — Phase 4 multi-tenant ramp
      ccx13 dedicated  2/8GB/80GB   €16.99 — when noisy-neighbour matters
  EOT
  type        = string
  default     = "cpx22"

  validation {
    condition     = contains(["cpx22", "cpx32", "cpx42", "ccx13", "ccx23"], var.hetzner_server_type)
    error_message = "Use an x86_64 SKU (cpx* or ccx*). ARM CAX SKUs were tried and rejected — Next.js builds fail."
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
# containers.tf. bin/with-secrets exports each as TF_VAR_* from its BWS key.

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

variable "allow_masterkey_rotation" {
  description = <<-EOT
    One-time override for the lifecycle.prevent_destroy guard on
    `random_password.zitadel_masterkey`. Default false → prevent_destroy=true,
    blocking accidental `-replace` (rotating the masterkey makes the encrypted
    Zitadel projection table unreadable).

    To actually rotate, pass `TF_VAR_allow_masterkey_rotation=true` for that
    single apply, run `tofu apply -replace=random_password.zitadel_masterkey`,
    then unset the var. The full re-key flow (recovering session state, etc.)
    is documented in docs/secrets.md.
  EOT
  type        = bool
  default     = false
}

# ── Menu app runtime env ─────────────────────────────────────────────────────
# Every runtime env var the menu container needs is produced by TF
# resources in this root — no BWS round-trip, no infra_menu_* vars:
#   - Session-cookie key      → random_password.menu_session_secret  (zitadel.tf)
#   - OIDC client id/secret   → zitadel_application_oidc.menu        (zitadel.tf)
#   - SA management token     → zitadel_personal_access_token.menu_sa (zitadel.tf)
#   - S3 / assets credentials → cloudflare_api_token.assets_r2       (main.tf)
#   - OpenObserve ingest      → local mode (no R2 cold tier, no header needed)
# The matching dev .env.local (infra/dev/tofu/main.tf) emits the same
# keys with localhost values — one shape, two backends.

variable "iedora_admin_emails" {
  description = <<-EOT
    Emails that should be granted the cross-product `iedora-admin` Zitadel
    project role on every `just infra::deploy`. Each entry is resolved to a
    Zitadel user ID at plan time (see `scripts/lookup-zitadel-users.sh`);
    addresses that haven't signed in yet are silently skipped and land on
    the next apply after they self-provision via OIDC.

    Add a teammate: append their email here, commit, deploy.
  EOT
  type    = list(string)
  default = ["eduardoferdcarvalho@gmail.com"]
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

