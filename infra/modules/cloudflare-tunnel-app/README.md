# `cloudflare-tunnel-app` — shared Tofu module

Provisions the Cloudflare Tunnel + ingress + proxied DNS pattern shared by every iedora product that fronts an HTTP app on the homelab.

## What it owns per instantiation

- **One Cloudflare Tunnel** (`cloudflare_zero_trust_tunnel_cloudflared.this`).
- **Remote-managed ingress config** with a primary route to `http://kamal-proxy`, optional caller-supplied `extra_ingress` rules, and the catch-all 404 (appended automatically).
- **One proxied CNAME** at `var.public_hostname` pointing at the tunnel's `cfargotunnel.com` endpoint.
- **The connector token** (data source — v5 dropped the attribute on the resource).

## What it does NOT own

- R2 buckets / scoped tokens — those are per-product, declared in the product root.
- Anything outside Cloudflare (Kamal, Tailscale, GHCR).
- House's narrow workload token for wrangler — different shape, lives in `products/house/infra/tofu/`.

## Usage

```hcl
module "tunnel" {
  source = "../../../../infra/modules/cloudflare-tunnel-app"

  account_id      = var.account_id
  zone_id         = data.cloudflare_zone.this.id
  tunnel_name     = "menu"
  public_hostname = var.public_hostname

  # Optional. Each entry inserted BEFORE the catch-all 404.
  extra_ingress = []
}

# In the root's outputs.tf
output "tunnel_id"    { value = module.tunnel.id }
output "tunnel_token" { value = module.tunnel.token, sensitive = true }
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | Cloudflare account ID (validated as 32-char hex). |
| `zone_id` | string | yes | Cloudflare zone ID for the hostname (use the root's `data.cloudflare_zone.this.id`). |
| `tunnel_name` | string | yes | Logical name (kebab-case, 1-32 chars). Pick the product slug. |
| `public_hostname` | string | yes | Public FQDN — must be in the supplied zone. |
| `extra_ingress` | list(any) | no | Additional ingress rules. Default `[]`. |

## Outputs

| Name | Type | Sensitive | Description |
|---|---|---|---|
| `id` | string | no | Tunnel UUID. Used to build the `cfargotunnel.com` endpoint. |
| `token` | string | yes | Connector token consumed by the cloudflared accessory. |

## Migration from inline resources

If your root currently declares `cloudflare_zero_trust_tunnel_cloudflared.<product>` inline, switch to this module via `tofu state mv`. See the comment block at the top of `main.tf` for the exact addresses to move. A clean migration ends with `tofu plan` reporting **zero changes** — anything else means the state move missed something.
