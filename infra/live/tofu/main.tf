# Cloudflare zone + tunnel + DNS para iedora.
# Tunnel token escrito para .tunnel-token (lido por .kamal/secrets).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.19" }
    random     = { source = "hashicorp/random",      version = "~> 3.9"  }
    local      = { source = "hashicorp/local",       version = "~> 2.9"  }
  }
}

provider "cloudflare" {}

# ─── Variables ──────────────────────────────────────────────────────
variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_name" {
  description = "Cloudflare zone"
  type        = string
  default     = "iedora.com"
}

variable "hostnames" {
  description = "Hostnames públicos servidos pelo iedora-web via kamal-proxy"
  type        = list(string)
  default = [
    "iedora.com",
    "menu.iedora.com",
    "core.iedora.com",
    "imopush.iedora.com",
  ]
}

variable "r2_bucket_name" {
  description = "Nome do bucket R2 para uploads da app"
  type        = string
  default     = "iedora-assets"
}

variable "r2_cors_origins" {
  description = "Origins autorizadas a fazer PUT/POST directo ao bucket (browser uploads)"
  type        = list(string)
  default     = ["https://iedora.com", "https://menu.iedora.com", "https://core.iedora.com"]
}

# ─── Tunnel ─────────────────────────────────────────────────────────
resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "iedora" {
  account_id    = var.account_id
  name          = "iedora"
  tunnel_secret = random_id.tunnel_secret.b64_std
  config_src    = "cloudflare"
}

# Cloudflared corre como Kamal accessory na mesma docker network do
# kamal-proxy → ingress aponta para o container por nome.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "iedora" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.iedora.id

  config = {
    ingress = concat(
      [for h in var.hostnames : { hostname = h, service = "http://iedora-web-proxy:80" }],
      [{ service = "http_status:404" }]
    )
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "iedora" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.iedora.id
}

# ─── DNS ────────────────────────────────────────────────────────────
data "cloudflare_zone" "this" {
  filter = { name = var.zone_name }
}

resource "cloudflare_dns_record" "public" {
  for_each = toset(var.hostnames)

  zone_id = data.cloudflare_zone.this.zone_id
  name    = each.key
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.iedora.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# ─── R2 (object storage) ────────────────────────────────────────────
# Bucket + CORS + S3 creds geríveis via Tofu. As S3-compatible
# credentials são derivadas do `cloudflare_api_token`:
#   access_key_id     = token.id
#   secret_access_key = sha256(token.value)
# (issue cloudflare/terraform-provider-cloudflare#6626 resolvida Mar/2026)
resource "cloudflare_r2_bucket" "assets" {
  account_id    = var.account_id
  name          = var.r2_bucket_name
  location      = "weur"
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket_cors" "assets" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  rules = [{
    allowed = {
      methods = ["GET", "PUT", "POST", "HEAD"]
      origins = var.r2_cors_origins
      headers = ["*"]
    }
    max_age_seconds = 3600
  }]
}

# R2 API token com Object Read + Write em todos os buckets da conta.
# Permission group IDs são UUIDs estáveis publicados pela Cloudflare.
resource "cloudflare_api_token" "r2_rw" {
  name = "iedora-r2-rw"

  policies = [{
    effect = "allow"
    permission_groups = [
      { id = "2efd5506f9c8494dacb1fa10a3e7d5b6" }, # Workers R2 Storage Bucket Item Read
      { id = "db37e5f1cb1b4eb19e1ed79b9c1bb220" }, # Workers R2 Storage Bucket Item Write
    ]
    resources = jsonencode({
      "com.cloudflare.api.account.${var.account_id}" = "*"
    })
  }]
}

# Escreve as creds S3 para ficheiros locais (gitignored), lidos por
# .kamal/secrets — mesmo padrão do .tunnel-token.
resource "local_sensitive_file" "s3_access_key" {
  filename        = "${path.module}/.s3-access-key"
  file_permission = "0600"
  content         = cloudflare_api_token.r2_rw.id
}

resource "local_sensitive_file" "s3_secret_key" {
  filename        = "${path.module}/.s3-secret-key"
  file_permission = "0600"
  content         = sha256(cloudflare_api_token.r2_rw.value)
}

# ─── Outputs ────────────────────────────────────────────────────────
resource "local_sensitive_file" "tunnel_token" {
  filename        = "${path.module}/.tunnel-token"
  file_permission = "0600"
  content         = data.cloudflare_zero_trust_tunnel_cloudflared_token.iedora.token
}

output "tunnel_id" {
  value = cloudflare_zero_trust_tunnel_cloudflared.iedora.id
}

output "dns_records" {
  value = [for r in cloudflare_dns_record.public : r.name]
}

output "r2_bucket" {
  value = cloudflare_r2_bucket.assets.name
}

output "s3_endpoint" {
  value = "https://${var.account_id}.r2.cloudflarestorage.com"
}
