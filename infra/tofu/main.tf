# Shared infra — R2 backup bucket + its scoped S3-compatible token.
#
# Scope: ONE bucket + ONE narrow token. The Postgres container itself is
# declared in containers.tf (no Cloudflare resource needed). The token's
# permission scope is the single backup bucket — a leak can't reach the
# assets bucket or any other R2 on the account.

# Permission group UUID for "Workers R2 Storage Bucket Item Write". Global
# (not per-account), stable. Found via:
#   curl -H "Authorization: Bearer $TOKEN" \
#     https://api.cloudflare.com/client/v4/user/tokens/permission_groups |
#     jq '.result[] | select(.name=="Workers R2 Storage Bucket Item Write")'
locals {
  permission_group_r2_bucket_item_write = "2efd5506f9c8494dacb1fa10a3e7d5b6"
}

resource "cloudflare_r2_bucket" "backups" {
  account_id = var.account_id
  name       = var.backups_bucket_name
  location   = var.backups_bucket_location
}

resource "cloudflare_api_token" "backups_r2" {
  name = "iedora-backups-r2"

  policies = [{
    effect = "allow"
    permission_groups = [
      { id = local.permission_group_r2_bucket_item_write }
    ]
    # Scoped to this single bucket — URN pattern matches what the
    # Cloudflare dashboard emits when you scope a token via the UI:
    #   com.cloudflare.edge.r2.bucket.<account>_default_<bucket-name>
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.backups.name}" = "*"
    })
  }]
}

# ── OpenObserve (shared observability backend) ───────────────────────────────
# One bucket for OpenObserve's cold tier (parquet shards moved off local
# disk after the hot window), one scoped token, one tunnel for the UI +
# OTLP ingest endpoint at obs.iedora.com.
#
# Why this lives in shared infra/, not in a product root: OpenObserve
# receives spans from EVERY product (menu + any future addition). Tying
# it to any one product would mean a product teardown takes down telemetry.

data "cloudflare_zone" "iedora" {
  filter = {
    # Zone derives from the observability_hostname's tail. Same shape
    # the per-product roots use — keeps the tofu state portable if we
    # ever move to a different zone for ops.
    name = join(".", slice(
      split(".", var.observability_hostname),
      1,
      length(split(".", var.observability_hostname)),
    ))
  }
}

resource "cloudflare_r2_bucket" "observability" {
  account_id = var.account_id
  name       = var.observability_bucket_name
  location   = var.observability_bucket_location
}

resource "cloudflare_api_token" "observability_r2" {
  name = "iedora-observability-r2"

  policies = [{
    effect = "allow"
    permission_groups = [
      { id = local.permission_group_r2_bucket_item_write }
    ]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.observability.name}" = "*"
    })
  }]
}

# obs.iedora.com — direct DNS to the Hetzner box, grey-cloud (proxied=false).
# Replaced the CF Tunnel on 2026-05-20 to drop the dedicated cloudflared
# sidecar (one less always-on container) — OpenObserve UI is HTTP/1.1 only,
# Caddy handles TLS termination, no need for CF in path. Pre-customer ops
# tool: DDoS protection isn't a meaningful trade-off.
resource "cloudflare_dns_record" "obs_iedora" {
  zone_id = data.cloudflare_zone.iedora.id
  name    = var.observability_hostname
  type    = "A"
  content = hcloud_server.iedora.ipv4_address
  ttl     = 60
  proxied = false
  comment = "Direct to Hetzner — Caddy terminates TLS, no CF on path"
}

# ── ZITADEL IdP (issue #19) ──────────────────────────────────────────────────
# menu.iedora.com — direct DNS to the Hetzner box, grey-cloud (proxied=false).
# Replaces the per-product CF Tunnel that lived in products/menu/infra/tofu/.
# Caddy on the Hetzner box terminates TLS via Let's Encrypt + reverse-proxies
# to `infra-menu-web:3000` (see Caddyfile inlined in docker_container.caddy).
#
# Trade-off vs CF Tunnel: no CF DDoS / WAF / edge cache on this hostname.
# For pre-customer scale that's irrelevant; if menu ever serves real traffic
# at scale, flip `proxied = true` and add `--token` to a tunnel sidecar.
resource "cloudflare_dns_record" "menu_iedora" {
  zone_id = data.cloudflare_zone.iedora.id
  name    = var.menu_public_hostname
  type    = "A"
  content = hcloud_server.iedora.ipv4_address
  ttl     = 60
  proxied = false
  comment = "Direct to Hetzner — Caddy terminates TLS, no CF on path"
}

# auth.iedora.com — direct DNS to the Hetzner box, NO Cloudflare in path.
# This is the entire reason we moved off the homelab: Cloudflare Free blocks
# `application/grpc` content-type at the edge, breaking the Zitadel TF
# provider. Grey-cloud (proxied=false) sidesteps CF entirely; Caddy on the
# Hetzner box terminates TLS via Let's Encrypt + handles the /ui/v2/* split
# between the Go binary and the Next.js login app.
#
# Trade-off vs CF Tunnel: no DDoS protection on this hostname. Fine for an
# IdP that's authenticated-only (no anonymous endpoints worth attacking) and
# pre-customer. menu + obs keep CF Tunnel — they don't need gRPC.
resource "cloudflare_dns_record" "auth_iedora" {
  zone_id = data.cloudflare_zone.iedora.id
  name    = var.zitadel_hostname
  type    = "A"
  content = hcloud_server.iedora.ipv4_address
  ttl     = 60
  proxied = false
  comment = "Direct to Hetzner — grey cloud bypasses CF Free gRPC block (#19)"
}
