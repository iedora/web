# Hetzner VPS provisioning — replaces the homelab as the always-on host for
# every infra container. The homelab had no public IPv4 + Cloudflare Free
# blocks gRPC at the edge, so the Zitadel TF provider was unreachable. A
# €3.79/mo CAX11 in Falkenstein gives us a public IPv4 + lets us drop the
# CF Tunnel for auth.iedora.com (the only hostname that needs gRPC).
#
# Bootstrap is the same shape as every other cloud here: one BWS secret
# (IAC_BOOTSTRAP_HCLOUD_TOKEN, Read/Write project-scoped), then `tofu apply` owns
# everything else. See infra/CLAUDE.md hard rule #3 (BWS → Tofu → write-through).

# ── SSH key (derived from the BWS-stored private key) ────────────────────────
# Single source of truth: the operator's laptop has it in ssh-agent; CI
# loads it from BWS into a tempfile per job. Deriving the public key via
# `tls_public_key` avoids storing it in a second BWS secret. (The variable
# name `infra_ssh_private_key` is a tombstone — see variables.tf.)

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
    description = "HTTP (Caddy for auth.iedora.com + Let's Encrypt ACME challenges)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS (Caddy fronts auth.iedora.com — direct path, no CF in the way)"
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
# + zitadel + zitadel-login + 2 cloudflareds + the menu app container with
# idle RAM ~1.7 GB. Scale to cax21 (4/8) for Phase 4 multi-tenant ramp —
# Hetzner resize is in-place, no destroy/recreate.
#
# Image: Ubuntu 24.04 LTS (noble) — matches the homelab's host OS, broadest
# Docker arm64 package coverage.

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

  # Cloud-init: installs Docker via the upstream get.docker.com script,
  # hardens sshd, pre-creates the bind-mount dirs containers.tf expects.
  # Idempotent — re-running the same script is a no-op once Docker is in.
  user_data = <<-EOT
    #cloud-config
    package_update: true
    package_upgrade: false
    packages:
      - ca-certificates
      - curl
      - jq
    write_files:
      - path: /etc/ssh/sshd_config.d/iedora.conf
        content: |
          PermitRootLogin prohibit-password
          PasswordAuthentication no
          KbdInteractiveAuthentication no
    runcmd:
      - install -d -o root -g root -m 0755 /root/infra-postgres/data
      - install -d -o root -g root -m 0755 /root/infra-openobserve/openobserve-data
      - install -d -o root -g root -m 0755 /root/caddy
      - curl -fsSL https://get.docker.com | sh
      - systemctl enable --now docker
      - systemctl restart sshd
  EOT

  labels = {
    project = "iedora"
    role    = "infra"
  }

  lifecycle {
    # The cloud-init only runs on first boot. If we ever need to re-bake the
    # image, we have to delete + recreate (Hetzner doesn't re-run user_data
    # on existing servers). For now treat the box as cattle: rebuild from
    # scratch by replacing this resource if cloud-init changes meaningfully.
    ignore_changes = [user_data]
  }
}

# ── Docker readiness barrier ────────────────────────────────────────────────
# cloud-init takes ~60-90s after server creation to finish installing Docker.
# The kreuzwerker/docker provider tries to connect during graph evaluation,
# so without a barrier the first apply races and fails ("connect: connection
# refused" or "cannot connect to docker daemon"). This null_resource SSHes
# in and waits until `docker info` succeeds, then docker_network.iedora +
# docker_volume.zitadel_bootstrap depend on it (every container depends on
# one of those, so the wait is transitive).

resource "null_resource" "docker_ready" {
  triggers = {
    # Re-run only if the server itself is replaced.
    server_id = hcloud_server.iedora.id
  }

  connection {
    type        = "ssh"
    host        = hcloud_server.iedora.ipv4_address
    user        = "root"
    private_key = var.infra_ssh_private_key
    timeout     = "5m"
  }

  provisioner "remote-exec" {
    inline = [
      "until docker info >/dev/null 2>&1; do echo 'waiting for docker daemon...'; sleep 5; done",
      "echo '✓ docker ready'",
    ]
  }
}
