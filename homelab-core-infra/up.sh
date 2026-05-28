#!/usr/bin/env bash
# Boot homelab-core-infra. Secrets vivem em BWS; este script materializa-os
# para um `.env` efémero e corre `docker compose up -d`. Idempotente.
#
# Local (Mac dev, sem `extras`, só OpenObserve):
#   ./homelab-core-infra/up.sh
#
# Remote (Beelink/homelab, com `extras` → openobserve + gitea + runner):
#   ./homelab-core-infra/up.sh --host ssh://root@192.168.50.53
#
# Usa `DOCKER_HOST=ssh://...` — o daemon remoto recebe os comandos como se
# fosse local. `configs:` no compose viaja em-band, dispensando scp.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado
#   - Para --host: SSH key carregada no agent + docker daemon no host remoto
#   - BWS: OPENOBSERVE_ADMIN_PASSWORD

set -euo pipefail

HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')
SECRETS=$(bws secret list "$PROJECT_ID" -o json)
get() { echo "$SECRETS" | jq -r ".[]|select(.key==\"$1\")|.value"; }

ZO_EMAIL="eduardoferdcarvalho@gmail.com"
ZO_PASS=$(get OPENOBSERVE_ADMIN_PASSWORD)
if [ -z "$ZO_PASS" ]; then
  echo "BWS key em falta: OPENOBSERVE_ADMIN_PASSWORD" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# `.env` é sempre materializado localmente; com DOCKER_HOST=ssh://, o
# `docker compose` resolve env-files no cliente (local) e injecta os
# valores nos containers remotos via API. Não precisa de viajar.
( cd "$HERE" && umask 077 && cat > .env <<EOF
ZO_ROOT_USER_EMAIL=${ZO_EMAIL}
ZO_ROOT_USER_PASSWORD=${ZO_PASS}
EOF
)

COMPOSE_ARGS=(-f "$HERE/docker-compose.yml")
if [ -n "$HOST" ]; then
  echo "→ remote ($HOST): docker compose --profile extras up -d"
  export DOCKER_HOST="$HOST"
  COMPOSE_ARGS+=(--profile extras)
else
  echo "→ local: docker compose up -d (sem extras)"
fi

docker compose "${COMPOSE_ARGS[@]}" up -d

echo "✓ homelab-core-infra up."
