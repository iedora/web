output "public_hostname" {
  description = "FQDN visitors hit for the app. Surface for downstream tooling — DNS itself is managed at the repo-root infra/tofu/."
  value       = var.public_hostname
}

output "assets_hostname" {
  description = "FQDN where the public R2 assets bucket is served from."
  value       = local.assets_hostname
}

output "assets_public_url" {
  description = "Base URL for public asset reads — used as S3_PUBLIC_URL by the app."
  value       = "https://${local.assets_hostname}"
}

output "assets_endpoint" {
  description = "S3-compatible endpoint for the assets bucket — used as S3_ENDPOINT by the app."
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}

output "assets_bucket_name" {
  description = "Name of the R2 bucket holding user-uploaded assets."
  value       = cloudflare_r2_bucket.assets.name
}

output "assets_r2_access_key_id" {
  description = "R2 S3-compatible Access Key ID for the app's asset uploads."
  value       = cloudflare_api_token.assets_r2.id
}

output "assets_r2_secret_access_key" {
  description = "R2 S3-compatible Secret Access Key (SHA-256 of the token value)."
  value       = sha256(cloudflare_api_token.assets_r2.value)
  sensitive   = true
}
