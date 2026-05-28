#!/usr/bin/env bash
# Boot do connector iedora-public. Pressupõe scripts/cf-tunnel.sh já correu
# (provisionou tunnel + DNS + IEDORA_TUNNEL_TOKEN em BWS).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

echo "→ iedora-public connector (docker compose up -d)"
bws run -- docker compose up -d
