#!/usr/bin/env bash
# Provisiona o tunnel + boot do connector. Idempotente.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

bash scripts/provision.sh

echo ""
echo "→ connector (docker compose up -d)"
bws run -- docker compose up -d
