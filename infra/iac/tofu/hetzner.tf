# Hetzner VPS provisioning. Owns the box itself + the first-boot
# cloud-init that installs docker, drops the compose stack at
# /etc/iedora/, and registers `iedora.service` to bring everything up.
#
# Day-2 changes to compose/Caddyfile DON'T re-run cloud-init — they're
# delivered by `terraform_data.iedora_sync` (see sync.tf). One SSH
# session per change, default Tofu parallelism, no per-container SSH.

# ── SSH key (derived from the BWS-stored private key) ────────────────────────
# Single source of truth: the operator's laptop has it in ssh-agent; CI
# loads it from BWS into a tempfile per job. Deriving the public key via
# `tls_public_key` avoids storing it in a second BWS secret.

data "tls_public_key" "operator" {
  private_key_openssh = var.infra_ssh_private_key
}

resource "hcloud_ssh_key" "operator" {
  name       = "iedora-operator"
  public_key = data.tls_public_key.operator.public_key_openssh
}

# ── Firewall ────────────────────────────────────────────────────────────────
# Public-facing rules; deliberately minimal. Egress unrestricted (default).

resource "hcloud_firewall" "iedora" {
  name = "iedora"

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "SSH (key-only auth enforced by sshd_config)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP (Caddy + Let's Encrypt ACME challenges)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS (Caddy fronts auth.iedora.com + menu.iedora.com)"
  }

  rule {
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "ICMP / ping (operational debugging)"
  }
}

# ── The server ──────────────────────────────────────────────────────────────
# CAX11: 2 vCPU ARM Ampere, 4 GB RAM, 40 GB SSD. Covers postgres + openobserve
# + zitadel + zitadel-login + caddy + menu container + backups with idle RAM
# ~1.7 GB. Scale to cax21 (4/8) for Phase 4 multi-tenant ramp — Hetzner
# resize is in-place, no destroy/recreate.

resource "hcloud_server" "iedora" {
  name         = "iedora"
  image        = "ubuntu-24.04"
  server_type  = var.hetzner_server_type
  location     = var.hetzner_location
  ssh_keys     = [hcloud_ssh_key.operator.id]
  firewall_ids = [hcloud_firewall.iedora.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # First-boot bootstrap. Installs docker, writes the compose stack
  # under /etc/iedora/, enables `iedora.service`. Day-2 compose changes
  # are pushed by `terraform_data.iedora_sync`; cloud-init never re-runs
  # on an existing server (Hetzner doesn't re-execute user_data).
  user_data = templatefile("${path.module}/templates/cloud-init.yml", {
    compose_yaml      = local.compose_yaml
    caddyfile         = local.caddyfile
    postgres_init_sql = local.postgres_init_sql
    ghcr_auth_b64     = base64encode("${var.github_owner}:${var.infra_ghcr_token}")
  })

  labels = {
    project = "iedora"
    role    = "infra"
  }

  lifecycle {
    # cloud-init runs once. Compose / Caddyfile updates go through
    # `terraform_data.iedora_sync` — we deliberately ignore user_data
    # so a compose edit doesn't trigger a server replace (which would
    # wipe bind-mounted postgres data).
    ignore_changes = [user_data]
  }
}
