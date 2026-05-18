terraform {
  required_version = "~> 1.15"

  # Modules declare their provider REQUIREMENTS (so a root that doesn't
  # depend on Cloudflare gets a clear error) but inherit the configured
  # provider from the calling root — there's no `provider { ... }` block here.
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }
}
