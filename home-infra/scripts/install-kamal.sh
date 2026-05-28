#!/usr/bin/env bash
# Idempotent server-side install of Kamal (+ pré-requisitos) via SSH ao
# `HOMELAB_HOST`. Genérico — sem hardcodes de app/repo/host.
#
# Cobre:
#   1. APT: ruby+dev, build-essential, git, curl, jq, unzip
#   2. Kamal gem
#   3. BWS CLI (`kamal secrets fetch --adapter bitwarden-sm`)
#   4. SSH loopback keypair em /root/.ssh/ci_ed25519 + authorized_keys
#      (qualquer kamal deploy local-on-host usa esta key)
#
# Pré-requisitos:
#   HOMELAB_HOST     ex: ssh://root@<ip>

set -euo pipefail
: "${HOMELAB_HOST:?HOMELAB_HOST must be set (e.g. ssh://root@<ip>)}"

KAMAL_VERSION="${KAMAL_VERSION:-2.11.0}"
BWS_VERSION="${BWS_VERSION:-0.5.0}"
SSH_TARGET="${HOMELAB_HOST#ssh://}"

# shellcheck disable=SC2087  # vars expanded client-side, intencional
ssh "$SSH_TARGET" bash <<REMOTE
set -euo pipefail

step() { printf "  → %s" "\$1"; }
ok()   { printf " ✓\n"; }
skip() { printf " (já)\n"; }

# 1. APT deps
step "apt deps (ruby, build-essential, git, curl, jq, unzip)"
if command -v gem >/dev/null && command -v gcc >/dev/null && command -v git >/dev/null && command -v jq >/dev/null; then
  skip
else
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends \
    ca-certificates curl unzip jq ruby ruby-dev build-essential git >/dev/null
  ok
fi

# 2. Kamal gem
step "kamal gem $KAMAL_VERSION"
if gem list -i kamal -v '$KAMAL_VERSION' >/dev/null 2>&1; then
  skip
else
  gem install --no-document kamal -v '$KAMAL_VERSION' >/dev/null
  ok
fi

# 3. BWS CLI
step "bws cli $BWS_VERSION"
if command -v bws >/dev/null && bws --version 2>&1 | grep -q '$BWS_VERSION'; then
  skip
else
  curl -fsSL "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-x86_64-unknown-linux-gnu-${BWS_VERSION}.zip" -o /tmp/bws.zip
  unzip -q -o /tmp/bws.zip -d /tmp/bws
  install -m 0755 /tmp/bws/bws /usr/local/bin/bws
  rm -rf /tmp/bws /tmp/bws.zip
  ok
fi

# 4. SSH loopback keypair (kamal local-on-host SSHs root@self)
step "ssh loopback keypair (ci_ed25519)"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -d /root/.ssh/ci_ed25519 ] && rm -rf /root/.ssh/ci_ed25519
if [ -f /root/.ssh/ci_ed25519 ]; then
  skip
else
  ssh-keygen -t ed25519 -f /root/.ssh/ci_ed25519 -N "" -C "kamal-loopback" -q
  chmod 600 /root/.ssh/ci_ed25519
  ok
fi

step "authorized_keys (loopback pub)"
PUB=\$(cat /root/.ssh/ci_ed25519.pub)
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
if grep -qxF "\$PUB" /root/.ssh/authorized_keys; then
  skip
else
  echo "\$PUB" >> /root/.ssh/authorized_keys
  ok
fi
REMOTE
