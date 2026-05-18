output "public_hostname" {
  description = "FQDN routed to kamal-proxy."
  value       = var.public_hostname
}

output "tunnel_id" {
  description = "Cloudflare Tunnel UUID."
  value       = module.tunnel.id
}

output "tunnel_token" {
  description = "Connector token for the cloudflared accessory. Read by .kamal/secrets via `tofu output -raw tunnel_token`."
  value       = module.tunnel.token
  sensitive   = true
}
