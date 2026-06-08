# Cloudflare R2 bucket para uploads dos utilizadores + token S3-compat
# bucket-scoped. A app consome as creds como S3_* env vars (geridos em
# apps/web/.env.prod via sops; ver README).

# ── Variables ──────────────────────────────────────────────────────────────
variable "tf_state_passphrase" {
  type        = string
  sensitive   = true
  description = "Passphrase do state encryption. Vem do homelab-iac via TF_VAR_tf_state_passphrase (source homelab-iac/iac/.envrc)."
}

variable "cf_api_token" {
  type        = string
  sensitive   = true
  description = "CF API token. Vem do homelab-iac via TF_VAR_cf_api_token (source homelab-iac/iac/.envrc)."
}

variable "r2_account_id" {
  type        = string
  description = "CF account ID para R2. Vem do homelab-iac via TF_VAR_r2_account_id (identificador, não-secret)."
}

variable "bucket_name" {
  type        = string
  default     = "iedora-assets"
  description = "Nome do bucket R2 para uploads. Único por conta CF."
}

variable "cors_origins" {
  type = list(string)
  default = [
    "https://iedora.com",
    "https://menu.iedora.com",
    "https://core.iedora.com",
  ]
  description = "Origens browser autorizadas a PUT/POST directamente no bucket (signed URLs)."
}

# ── Bucket + CORS ──────────────────────────────────────────────────────────
resource "cloudflare_r2_bucket" "assets" {
  account_id    = var.r2_account_id
  name          = var.bucket_name
  location      = "weur"
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket_cors" "assets" {
  account_id  = var.r2_account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  rules = [{
    allowed = {
      methods = ["GET", "PUT", "POST", "HEAD"]
      origins = var.cors_origins
      headers = ["*"]
    }
    max_age_seconds = 3600
  }]
}

# ── Bucket-scoped S3-compatible token ──────────────────────────────────────
# CF não tem endpoint dedicado para tokens R2; /user/tokens devolve um token
# genérico CF que se consome como S3 creds via convenção CF:
#   access_key_id     = token.id
#   secret_access_key = sha256(token.value)
data "cloudflare_api_token_permission_groups_list" "all" {}

locals {
  r2_read_pg_id = one([
    for pg in data.cloudflare_api_token_permission_groups_list.all.result :
    pg.id if pg.name == "Workers R2 Storage Bucket Item Read"
  ])
  r2_write_pg_id = one([
    for pg in data.cloudflare_api_token_permission_groups_list.all.result :
    pg.id if pg.name == "Workers R2 Storage Bucket Item Write"
  ])
}

resource "cloudflare_api_token" "assets_rw" {
  name = "iedora-web-assets-rw"
  policies = [{
    effect = "allow"
    permission_groups = [
      { id = local.r2_read_pg_id },
      { id = local.r2_write_pg_id },
    ]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.r2_account_id}_default_${var.bucket_name}" = "*"
    })
  }]
}

# ── Outputs (vão para apps/web/.env.prod via sops + Coolify UI) ────────────
output "s3_endpoint" {
  value       = "https://${var.r2_account_id}.r2.cloudflarestorage.com"
  description = "S3_ENDPOINT em apps/web/.env.prod."
}

output "s3_bucket" {
  value       = cloudflare_r2_bucket.assets.name
  description = "S3_BUCKET em apps/web/.env.prod."
}

output "s3_region" {
  value       = "auto"
  description = "S3_REGION em apps/web/.env.prod (sempre \"auto\" para R2)."
}

output "s3_access_key_id" {
  value       = cloudflare_api_token.assets_rw.id
  sensitive   = true
  description = "S3_ACCESS_KEY em apps/web/.env.prod. Reveal: tofu output -raw s3_access_key_id"
}

output "s3_secret_access_key" {
  value       = sha256(cloudflare_api_token.assets_rw.value)
  sensitive   = true
  description = "S3_SECRET_KEY em apps/web/.env.prod. Reveal: tofu output -raw s3_secret_access_key"
}
