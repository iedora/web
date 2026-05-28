#!/usr/bin/env bash
# Boot OpenObserve. Sem flags — `DOCKER_HOST=ssh://...` para remote.
# Idempotente.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado
#   - BWS key: OPENOBSERVE_ADMIN_PASSWORD

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')
SECRETS=$(bws secret list "$PROJECT_ID" -o json)
ZO_PASS=$(echo "$SECRETS" | jq -r '.[]|select(.key=="OPENOBSERVE_ADMIN_PASSWORD")|.value')
[ -n "$ZO_PASS" ] && [ "$ZO_PASS" != "null" ] || { echo "BWS key em falta: OPENOBSERVE_ADMIN_PASSWORD" >&2; exit 1; }

# Network partilhada com vizinhos (gitea, iedora) — idempotent.
docker network inspect homelab-core >/dev/null 2>&1 || docker network create homelab-core

cd "$HERE"
umask 077
cat > .env <<EOF
ZO_ROOT_USER_EMAIL=eduardoferdcarvalho@gmail.com
ZO_ROOT_USER_PASSWORD=${ZO_PASS}
EOF

docker compose up -d
echo "✓ openobserve up (http://<host>:5080)"
