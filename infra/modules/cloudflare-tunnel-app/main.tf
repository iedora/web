# Cloudflare Tunnel + ingress + DNS — the pattern shared by every iedora
# product that fronts an HTTP app on the homelab.
#
# What this module owns per call:
#   - One Cloudflare Tunnel (named after var.tunnel_name)
#   - Its remote-managed ingress config (a primary route → kamal-proxy plus
#     any var.extra_ingress entries the caller passes in, with the
#     catch-all 404 appended automatically)
#   - A proxied CNAME at var.public_hostname pointing at the tunnel
#   - A data source for the tunnel connector token (cloudflared accessory)
#
# Resources are addressed `<resource>.this` — symmetric, predictable, easy
# for an LLM to refactor or import. The single-resource-per-name pattern
# matches the "one product per module instance" model.
#
# Migration (one-time) for menu / genkan to adopt this module:
#   1. Replace the inline resources in products/<p>/infra/tofu/<p>.tf with
#      a `module "tunnel" { source = "../../../../infra/modules/cloudflare-tunnel-app" ... }` block.
#   2. tofu init -upgrade  (to register the module)
#   3. tofu state mv 'cloudflare_zero_trust_tunnel_cloudflared.<p>' 'module.tunnel.cloudflare_zero_trust_tunnel_cloudflared.this'
#      tofu state mv 'cloudflare_zero_trust_tunnel_cloudflared_config.<p>' 'module.tunnel.cloudflare_zero_trust_tunnel_cloudflared_config.this'
#      tofu state mv 'cloudflare_dns_record.<p>' 'module.tunnel.cloudflare_dns_record.this'
#      tofu state mv 'data.cloudflare_zero_trust_tunnel_cloudflared_token.<p>' 'module.tunnel.data.cloudflare_zero_trust_tunnel_cloudflared_token.this'
#   4. tofu plan  → must report zero changes. If it reports a destroy/create
#      pair, abort and re-check the state mv addresses.
#   5. tofu apply  (no-op apply confirms the mv stuck).

resource "cloudflare_zero_trust_tunnel_cloudflared" "this" {
  account_id = var.account_id
  name       = var.tunnel_name
  config_src = "cloudflare" # remotely-managed config → ingress below applies
}

# Token used by the cloudflared accessory. v5 dropped the attribute on the
# resource; surfaced via data source instead.
data "cloudflare_zero_trust_tunnel_cloudflared_token" "this" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "this" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id

  config = {
    # Default route → the kamal-proxy singleton container on the host.
    # Extra ingress entries from the caller (e.g. an admin-only hostname
    # routing to a different service) come AFTER. The catch-all 404
    # closes the list — required by cloudflared.
    ingress = concat(
      [
        {
          hostname = var.public_hostname
          service  = "http://kamal-proxy"
        },
      ],
      var.extra_ingress,
      [
        {
          service = "http_status:404"
        },
      ],
    )
  }
}

# Proxied CNAME at the public hostname → the tunnel's cfargotunnel.com
# anycast endpoint. `ttl = 1` is the API encoding for "auto", required when
# `proxied = true`.
resource "cloudflare_dns_record" "this" {
  zone_id = var.zone_id
  name    = var.public_hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.this.id}.cfargotunnel.com"
  ttl     = 1
  proxied = true
}
