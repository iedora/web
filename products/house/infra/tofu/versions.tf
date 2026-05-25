terraform {
  required_version = "~> 1.12"

  # Remote state on Cloudflare R2 (same bucket as the central root,
  # different `key`). See infra/tofu/versions.tf for the full
  # rationale — Rule 2 of docs/deploy.md § Environment guardrails.
  backend "s3" {
    bucket = "iedora-tofu-state"
    key    = "products/house/infra/tofu/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://2716bf6ee8be2880904e70f19050d2ef.r2.cloudflarestorage.com"
    }
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
    use_lockfile                = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }

  # State + plan encryption (OpenTofu 1.7+). Same passphrase as the menu root —
  # both consume TF_VAR_state_passphrase exported by bin/with-secrets from BWS.
  # Each root still has its OWN encrypted state file under terraform.tfstate.
  encryption {
    key_provider "pbkdf2" "default" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "default" {
      keys = key_provider.pbkdf2.default
    }
    state {
      method   = method.aes_gcm.default
      enforced = true
    }
    plan {
      method   = method.aes_gcm.default
      enforced = true
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
