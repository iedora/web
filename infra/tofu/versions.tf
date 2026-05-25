terraform {
  required_version = "~> 1.12"

  # Remote state on Cloudflare R2 via the S3-compatible backend.
  # Per docs/deploy.md § Environment guardrails (Rule 2) — the
  # encrypted-in-git state pattern is gone; concurrent apply/lock
  # behaviour is now R2-native (`use_lockfile = true`).
  #
  # The R2 bucket + scoped API token are minted out-of-band by
  # `bin/state-bucket-bootstrap` (it's a chicken/egg: this backend
  # block needs the bucket to exist before `tofu init` can run).
  # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are injected by
  # `bin/with-secrets --stage iac` from the BWS-written keys
  # IAC_BOOTSTRAP_TOFU_STATE_{ACCESS,SECRET}_KEY.
  #
  # account_id is hardcoded here because backend blocks can't take
  # variables. Not a secret — the same account ID appears in CI vars
  # and in the data/assets bucket resources below. If forking to a
  # different account, update both this endpoint and the bootstrap.
  backend "s3" {
    bucket = "iedora-tofu-state"
    key    = "infra/tofu/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://2716bf6ee8be2880904e70f19050d2ef.r2.cloudflarestorage.com"
    }
    # R2 doesn't implement the EC2 metadata API or the AWS STS
    # validation flow these flags gate — disable them all.
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
    # OpenTofu 1.10+ native locking (sidecar `.tflock` object in the
    # same bucket prefix). Replaces the DynamoDB lock table that the
    # AWS s3 backend traditionally pairs with — R2 has no DynamoDB
    # equivalent, and use_lockfile sidesteps it entirely.
    use_lockfile = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.12"
    }
    # Manages the Hetzner CAX11 VPS (replaced the homelab on 2026-05-19 — the
    # homelab had no public IPv4 + Cloudflare Free blocks gRPC at the edge,
    # which broke the Zitadel TF provider. Hetzner has a public IPv4 so
    # auth.iedora.com goes direct, no CF in path for that hostname).
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.55"
    }
    # Derives the operator's SSH public key from the BWS-stored private key
    # via `data "tls_public_key"`. Avoids storing the public key separately
    # — single source of truth for the key material.
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
    # Synthetic "wait until X" resources used to block dependent resources
    # behind a remote-exec readiness probe (Docker daemon on the new Hetzner
    # box before the docker provider tries to connect).
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    # Manages every container on the Hetzner box (postgres, openobserve,
    # zitadel, backups, caddy, tunnels, plus the menu app itself). The
    # provider talks to the Docker daemon over SSH.
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.7"
    }
    # Mints the menu session cookie's encryption key directly in TF state.
    # Rotate via `tofu apply -replace=random_password.menu_session_secret`.
    # Zitadel app-state is no longer managed here — see infra/cmd/zitadel-apply.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State + plan encryption. Passphrase from TF_VAR_state_passphrase
  # (BWS key: IAC_BOOTSTRAP_STATE_PASSPHRASE).
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

# GitHub — reconciles the repo's Actions secrets + variables. Provider auth
# is a fine-grained PAT (BWS key IAC_BOOTSTRAP_GITHUB_API_TOKEN) scoped to one repo
# with permissions: Actions read+write, Secrets read+write, Variables
# read+write, Contents read. The PAT itself can't be created by Tofu
# (chicken/egg) — generate once at https://github.com/settings/tokens?type=beta
# and push to BWS. See infra/tofu/github.tf.
provider "github" {
  owner = var.github_owner
  token = var.github_token
}

# Hetzner Cloud — provisions the CAX11 VPS that runs every infra container.
# Auth is a project-scoped API token (IAC_BOOTSTRAP_HCLOUD_TOKEN, set once in BWS).
provider "hcloud" {
  token = var.infra_hcloud_token
}

# Docker — talks to the Hetzner box's Docker daemon over SSH. The IP comes
# from `hcloud_server.iedora.ipv4_address` (output of the hcloud provider),
# so the docker provider is implicitly downstream of the Hetzner one.
# `IAC_BOOTSTRAP_SSH_PRIVATE_KEY` is registered as `hcloud_ssh_key.operator` so
# cloud-init drops it into root's authorized_keys.
#
# `registry_auth` covers ghcr.io because the self-built backup image
# (ghcr.io/eduvhc/iedora-backup) is private. Everything else
# (postgres, openobserve, zitadel, caddy) is on public registries.
provider "docker" {
  host = "ssh://root@${hcloud_server.iedora.ipv4_address}"

  registry_auth {
    address  = "ghcr.io"
    username = var.github_owner
    password = var.infra_ghcr_token
  }
}
