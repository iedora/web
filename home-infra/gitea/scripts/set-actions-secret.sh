#!/usr/bin/env bash
# Util: publica um Actions secret numa repo via Gitea API. PUT é
# idempotent (cria ou actualiza).
#
# Genérico.
#
# Uso:
#   GITEA_URL=https://git.example.com \
#   GITEA_AUTH_TOKEN=<admin PAT, scope write:repository> \
#   REPO=owner/repo \
#   SECRET_NAME=KAMAL_REGISTRY_PASSWORD \
#   SECRET_VALUE=*** \
#     ./set-actions-secret.sh

set -euo pipefail
: "${GITEA_URL:?must be set}"
: "${GITEA_AUTH_TOKEN:?must be set (PAT scope write:repository)}"
: "${REPO:?must be set (owner/repo)}"
: "${SECRET_NAME:?must be set}"
: "${SECRET_VALUE:?must be set}"

HTTP=$(curl -sS -o /tmp/.gitea-secret-resp -w '%{http_code}' -X PUT \
  -H "Authorization: token $GITEA_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"$SECRET_VALUE\"}" \
  "$GITEA_URL/api/v1/repos/$REPO/actions/secrets/$SECRET_NAME")

case "$HTTP" in
  201|204) echo "✓ Actions secret $SECRET_NAME published ($REPO)" ;;
  *) echo "set-actions-secret: failed HTTP $HTTP: $(cat /tmp/.gitea-secret-resp)" >&2; exit 1 ;;
esac
rm -f /tmp/.gitea-secret-resp
