# Menu product (menu.iedora.com) — its own root module with its own state.
#
# Owns:
#   - Tunnel + ingress for the app (1 route: kamal-proxy)
#   - DNS CNAME for the menu hostname
#   - R2 assets bucket (public via custom domain) + scoped R2 token
#
# Does NOT own the backups bucket — that lives in `infra/tofu/` since
# backups cover every product's database (menu + genkan + future).
#
# The Cloudflare zone is also looked up in sibling product roots (e.g.
# `../../../house/infra/tofu/`) — same zone (`iedora.com`), one data source
# per root. That duplication is the price of keeping each product's state
# independently appliable; well worth the blast-radius isolation.
#
# Assets are served directly from R2 via a custom domain on Cloudflare's CDN
# — no tunnel hop, no Starlink uplink involved on hot paths. The tunnel only
# carries app traffic.

locals {
  # The zone is everything after the first dot in public_hostname:
  # `menu.iedora.com` → `iedora.com`. Looked up live so we don't carry a
  # redundant CLOUDFLARE_ZONE_ID alongside PUBLIC_HOSTNAME.
  zone_name = join(".", slice(split(".", var.public_hostname), 1, length(split(".", var.public_hostname))))

  # Default: assets.<rest-of-menu-hostname>. Override via var.assets_hostname.
  derived_assets_hostname = "assets.${local.zone_name}"
  assets_hostname         = coalesce(var.assets_hostname, local.derived_assets_hostname)
}

data "cloudflare_zone" "this" {
  filter = {
    name = local.zone_name
  }
}

# ── Cloudflare Tunnel + ingress + DNS ─────────────────────────────────────────
# Delegated to the shared cloudflare-tunnel-app module — every iedora product
# that fronts an HTTP app on the homelab uses the same shape (menu + genkan).
# Adding a 4th product = a `module "tunnel" { source = ... }` block in five
# lines.
#
# Asset traffic skips the tunnel entirely — R2 is served via its custom domain
# on Cloudflare's edge (see the R2 resources below). The module's ingress
# catch-all (`http_status:404`) covers anything that isn't `kamal-proxy`.

module "tunnel" {
  source = "../../../../infra/modules/cloudflare-tunnel-app"

  account_id      = var.account_id
  zone_id         = data.cloudflare_zone.this.id
  tunnel_name     = var.tunnel_name
  public_hostname = var.public_hostname
}

# ── R2 buckets ────────────────────────────────────────────────────────────────
# Cloudflare's R2 S3 API accepts a regular Cloudflare API token as credentials:
#   Access Key ID    = the token's ID
#   Secret Access Key = SHA-256(token value)
# Docs: https://developers.cloudflare.com/r2/api/tokens/
# Single `tofu apply` provisions both buckets + their scoped tokens.

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = var.assets_bucket_name
  location   = var.assets_bucket_location
}

# Public access via custom domain: Cloudflare provisions the cert + manages
# the CNAME automatically. Assets become readable at https://<domain>/<key>
# served from Cloudflare's edge, with default cache TTL for image MIME types.
resource "cloudflare_r2_custom_domain" "assets" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  domain      = local.assets_hostname
  zone_id     = data.cloudflare_zone.this.id
  enabled     = true
  min_tls     = "1.2"
}

# CORS — only the PUT path needs it (browser-direct presigned uploads).
# GET is unauthenticated; <img> tags don't need CORS. AllowedHeaders can't
# be "*" on R2, so we enumerate the one header the SDK sends.
resource "cloudflare_r2_bucket_cors" "assets" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name

  rules = [{
    allowed = {
      methods = ["PUT", "HEAD"]
      origins = ["https://${var.public_hostname}"]
      headers = ["Content-Type"]
    }
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }]
}

resource "cloudflare_api_token" "assets_r2" {
  name = "${var.tunnel_name}-assets-r2"

  policies = [{
    effect = "allow"
    permission_groups = [
      { id = local.permission_group_r2_bucket_item_write }
    ]
    # Scoped to the assets bucket only — same URN pattern as backups_r2.
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.assets.name}" = "*"
    })
  }]
}

# Permission group UUID for "Workers R2 Storage Bucket Item Write". These
# IDs are global to Cloudflare (not per-account) and stable. Looked up once
# via the API: GET /user/tokens/permission_groups | grep "R2 Storage Bucket Item Write".
locals {
  permission_group_r2_bucket_item_write = "2efd5506f9c8494dacb1fa10a3e7d5b6"
}
