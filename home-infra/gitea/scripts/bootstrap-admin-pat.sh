#!/usr/bin/env bash
# Setup one-time: cria PAT admin para o user instance-admin e guarda
# em BWS como `GITEA_ADMIN_PAT`. A partir daí todos os outros scripts
# (`create-org.sh`, `create-token.sh` para deploy PATs, etc.) usam-no
# via `bws_get GITEA_ADMIN_PAT` — sem mais prompts de password.
#
# Idempotente:
#   - Se GITEA_ADMIN_PAT já existe em BWS → no-op (skip prompt)
#   - ROTATE=1 force-rotaciona (revoga + cria + sobre-escreve em BWS)
#
# Pré-requisitos:
#   BWS_ACCESS_TOKEN  exportado
#   GITEA_USER        (default eduvhc) — o instance admin
#   GITEA_PASSWORD    prompt interactivo se não setada e PAT ainda não em BWS
#
# Após este step: zero prompts em consumers (my-services/<app>/bootstrap.sh).

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/shared"

# shellcheck source=../.env
. "$HERE/../.env"   # carrega GITEA_DOMAIN + GITEA_ADMIN_USERNAME

# Default ao endpoint LAN do gitea (porta 3030 publicada pelo compose).
# O tunnel admin (homelab-admin) só fica activo no step 5 do bootstrap,
# logo NÃO podemos usar git.iedora.com aqui. Override via env se needed.
GITEA_URL="${GITEA_URL:-http://${GITEA_DOMAIN}:3030}"
GITEA_USER="${GITEA_USER:-${GITEA_ADMIN_USERNAME:-eduvhc}}"
TOKEN_NAME="${TOKEN_NAME:-homelab-admin}"
TOKEN_SCOPES="${TOKEN_SCOPES:-write:admin,write:organization,write:repository,write:package,write:user}"

: "${BWS_ACCESS_TOKEN:?must be set}"

# shellcheck source=shared/bws.sh
. "$SHARED/bws.sh"

if [ "${ROTATE:-0}" != "1" ] && [ -n "$(bws_get GITEA_ADMIN_PAT)" ]; then
  echo "✓ GITEA_ADMIN_PAT já em BWS, skip (ROTATE=1 para força rotação)"
  exit 0
fi

# Prefer BWS::GITEA_ADMIN_PASSWORD (mesma origem usada pelo init container
# do compose para criar o user). Fallback para prompt interactivo se BWS
# não tiver.
if [ -z "${GITEA_PASSWORD:-}" ]; then
  GITEA_PASSWORD=$(bws_get GITEA_ADMIN_PASSWORD)
fi
if [ -z "${GITEA_PASSWORD:-}" ]; then
  read -r -s -p "Gitea password ($GITEA_USER): " GITEA_PASSWORD; echo
  read -r -p "Gitea OTP (Enter se não tens 2FA): " GITEA_OTP
fi
export GITEA_PASSWORD GITEA_OTP="${GITEA_OTP:-}"

PAT=$(
  GITEA_URL="$GITEA_URL" \
  GITEA_USER="$GITEA_USER" \
  GITEA_PASSWORD="$GITEA_PASSWORD" \
  GITEA_OTP="${GITEA_OTP:-}" \
  TOKEN_NAME="$TOKEN_NAME" \
  TOKEN_SCOPES="$TOKEN_SCOPES" \
    "$HERE/create-token.sh"
)

bws_secret_upsert GITEA_ADMIN_PAT "$PAT"

echo "✓ GITEA_ADMIN_PAT em BWS (token name: $TOKEN_NAME)"
