output "id" {
  description = "Cloudflare Tunnel UUID."
  value       = cloudflare_zero_trust_tunnel_cloudflared.this.id
}

output "token" {
  description = "Connector token for the cloudflared accessory. Consumed at deploy time by `.kamal/secrets` via `tofu output -raw tunnel_token` on the caller's root."
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.this.token
  sensitive   = true
}
