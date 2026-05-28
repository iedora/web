#!/usr/bin/env bash
# Util: cria um PAT via Gitea API. Idempotent — revoga PAT existente
# com mesmo nome antes de criar (rotação limpa). Stdout = valor do PAT.
#
# Suporta 2 modos de auth:
#
#   Basic auth (user+password do target):
#     endpoint: POST /users/{GITEA_USER}/tokens
#     uso típico: bootstrap inicial, antes de existir um admin PAT
#
#   Admin auth (GITEA_AUTH_TOKEN com scope write:admin):
#     endpoint: POST /admin/users/{GITEA_USER}/tokens
#     uso típico: automação ongoing, lê PAT do admin via BWS
#
# Genérico — qualquer consumer pode usar.
#
# Uso (basic):
#   GITEA_URL=https://git.example.com \
#   GITEA_USER=alice GITEA_PASSWORD=*** \
#   TOKEN_NAME=my-deploy-key \
#   TOKEN_SCOPES=read:repository,write:package \
#     ./create-token.sh
#
# Uso (admin PAT):
#   GITEA_URL=https://git.example.com \
#   GITEA_USER=alice \
#   GITEA_AUTH_TOKEN=<admin PAT> \
#   TOKEN_NAME=my-deploy-key \
#   TOKEN_SCOPES=read:repository,write:package \
#     ./create-token.sh
#
# Output: PAT value em stdout (capturar em var).

set -euo pipefail
: "${GITEA_URL:?must be set}"
: "${GITEA_USER:?must be set (target user para o token)}"
: "${TOKEN_NAME:?must be set}"
: "${TOKEN_SCOPES:?must be set (comma-separated)}"

if [ -n "${GITEA_AUTH_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: token $GITEA_AUTH_TOKEN")
  ENDPOINT="$GITEA_URL/api/v1/admin/users/$GITEA_USER/tokens"
elif [ -n "${GITEA_PASSWORD:-}" ]; then
  AUTH=(-u "$GITEA_USER:$GITEA_PASSWORD")
  [ -n "${GITEA_OTP:-}" ] && AUTH+=(-H "X-Gitea-OTP: $GITEA_OTP")
  ENDPOINT="$GITEA_URL/api/v1/users/$GITEA_USER/tokens"
else
  echo "create-token: need GITEA_AUTH_TOKEN, or GITEA_PASSWORD" >&2
  exit 1
fi

# Revoke if exists (idempotent). 404 e 204 ambos OK.
curl -fsS -o /dev/null -X DELETE "${AUTH[@]}" \
  "$ENDPOINT/$TOKEN_NAME" 2>/dev/null || true

SCOPES_JSON=$(echo "$TOKEN_SCOPES" | jq -R 'split(",")|map(ltrimstr(" ")|rtrimstr(" "))')

PAT=$(curl -fsS "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$TOKEN_NAME\",\"scopes\":$SCOPES_JSON}" \
  "$ENDPOINT" | jq -r '.sha1')

[ -n "$PAT" ] && [ "$PAT" != "null" ] || { echo "create-token: failed for $TOKEN_NAME" >&2; exit 1; }
echo "$PAT"
