output "backups_bucket_name" {
  description = "Name of the R2 bucket holding Postgres dumps."
  value       = cloudflare_r2_bucket.backups.name
}

output "backups_r2_access_key_id" {
  description = "R2 S3-compatible Access Key ID for the backups accessory."
  value       = cloudflare_api_token.backups_r2.id
}

output "backups_r2_secret_access_key" {
  description = "R2 S3-compatible Secret Access Key (SHA-256 of the token value)."
  value       = sha256(cloudflare_api_token.backups_r2.value)
  sensitive   = true
}

# ── OpenObserve outputs ──────────────────────────────────────────────────────
# Used to be read by infra/kamal/.kamal/secrets; now flow directly into
# the docker_container envs in containers.tf. Keeping the outputs around
# because the menu workspace still reads `observability_tunnel_token`
# if/when it wires its own observability tunnel in the future. No
# write-through to BWS: deploys for shared infra always run locally where
# Tofu state is available.

output "observability_bucket_name" {
  description = "R2 bucket holding OpenObserve's parquet cold-tier shards."
  value       = cloudflare_r2_bucket.observability.name
}

output "observability_r2_access_key_id" {
  description = "R2 S3-compatible Access Key ID for the OpenObserve accessory."
  value       = cloudflare_api_token.observability_r2.id
}

output "observability_r2_secret_access_key" {
  description = "R2 S3-compatible Secret Access Key (SHA-256 of the token value)."
  value       = sha256(cloudflare_api_token.observability_r2.value)
  sensitive   = true
}

output "observability_tunnel_token" {
  description = "Cloudflared connector token for the obs.iedora.com tunnel."
  value       = module.observability_tunnel.token
  sensitive   = true
}

# ── Hetzner outputs ──────────────────────────────────────────────────────────
# IPv4 is the source of truth for: the docker provider host, every per-product
# Kamal `.env` ONPREM_HOST, the zitadel-rebootstrap SSH commands, and the
# A records pointed at the box. Outputting it here means `just infra::deploy`
# can write through to BWS as INFRA_ONPREM_HOST so the per-product workspaces
# don't need their own hcloud provider.

output "hetzner_ipv4" {
  description = "Public IPv4 of the Hetzner CAX11 box. A records + SSH targets resolve here."
  value       = hcloud_server.iedora.ipv4_address
}

output "hetzner_ipv6" {
  description = "Public IPv6 of the Hetzner box. Useful for AAAA records once we're ready to dual-stack."
  value       = hcloud_server.iedora.ipv6_address
}
