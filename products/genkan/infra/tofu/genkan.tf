# Genkan (genkan.iedora.com) — its own root module with its own encrypted state.
#
# Owns:
#   - Cloudflare Tunnel + ingress for the auth app (1 route: kamal-proxy)
#   - DNS CNAME for genkan.iedora.com → tunnel
#
# Does NOT own:
#   - Postgres (shares menu's postgres accessory on the homelab — connects
#     over the shared kamal Docker network using DATABASE_URL)
#   - R2 (genkan stores no assets)
#   - Backups (menu's daily pg_dump covers the auth.* schema too)
#
# The Cloudflare zone for the host is looked up live from the public_hostname
# so we don't carry a redundant zone ID. Same pattern as products/menu/infra/tofu.

locals {
  # `genkan.iedora.com` → `iedora.com`
  zone_name = join(".", slice(split(".", var.public_hostname), 1, length(split(".", var.public_hostname))))
}

data "cloudflare_zone" "this" {
  filter = {
    name = local.zone_name
  }
}

# ── Cloudflare Tunnel + ingress + DNS ─────────────────────────────────────────
# Delegated to the shared cloudflare-tunnel-app module. See products/menu/
# infra/tofu/menu.tf for the same pattern.

module "tunnel" {
  source = "../../../../infra/modules/cloudflare-tunnel-app"

  account_id      = var.account_id
  zone_id         = data.cloudflare_zone.this.id
  tunnel_name     = var.tunnel_name
  public_hostname = var.public_hostname
}
