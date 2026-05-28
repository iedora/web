#!/usr/bin/env bash
# Boot Gitea (+ Caddy subservice + Actions runner). Sem flags —
# `DOCKER_HOST=ssh://...` para remote. Idempotente.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado
#   - BWS key: CLOUDFLARE_API_TOKEN (Caddy DNS-01 challenge)
#   - Beelink: porta 4443 livre (kamal-proxy fica em :443)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')
SECRETS=$(bws secret list "$PROJECT_ID" -o json)
CF_TOKEN=$(echo "$SECRETS" | jq -r '.[]|select(.key=="CLOUDFLARE_API_TOKEN")|.value')
[ -n "$CF_TOKEN" ] && [ "$CF_TOKEN" != "null" ] || { echo "BWS key em falta: CLOUDFLARE_API_TOKEN" >&2; exit 1; }

# Network partilhada — criada por qualquer service primeiro a arrancar.
docker network inspect homelab-core >/dev/null 2>&1 || docker network create homelab-core

cd "$HERE"
umask 077
cat > .env <<EOF
CLOUDFLARE_API_TOKEN=${CF_TOKEN}
EOF

docker compose up -d
echo "✓ gitea up — UI: http://<host>:3030, registry: https://git.iedora.com:4443"
