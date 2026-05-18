terraform {
  required_version = "~> 1.15"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.29"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.12"
    }
  }

  # State + plan encryption. Passphrase from TF_VAR_state_passphrase
  # (BWS key: INFRA_STATE_PASSPHRASE).
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

# Tailscale — provisions the tailnet ACL + the CI OAuth client used by the
# GitHub Actions runner to join the tailnet. The provider authenticates via
# a BOOTSTRAP OAuth client (created once manually in the Tailscale admin
# console with scopes `policy_file` + `oauth_keys`). The provider then mints
# the narrower CI client. See infra/tofu/tailscale.tf.
provider "tailscale" {
  oauth_client_id     = var.tailscale_oauth_client_id
  oauth_client_secret = var.tailscale_oauth_client_secret
}

# GitHub — reconciles the repo's Actions secrets + variables. Provider auth
# is a fine-grained PAT (BWS key INFRA_GITHUB_API_TOKEN) scoped to one repo
# with permissions: Actions read+write, Secrets read+write, Variables
# read+write, Contents read. The PAT itself can't be created by Tofu
# (chicken/egg) — generate once at https://github.com/settings/tokens?type=beta
# and push to BWS. See infra/tofu/github.tf.
provider "github" {
  owner = var.github_owner
  token = var.github_token
}
