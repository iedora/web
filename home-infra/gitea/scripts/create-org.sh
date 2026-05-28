#!/usr/bin/env bash
# Util: cria/actualiza uma org no Gitea e adiciona owners/members aos
# teams certos. Idempotente.
#
# Genérico — qualquer consumer chama com env vars próprias.
#
# Uso (auth via PAT — preferido):
#   GITEA_URL=https://git.example.com \
#   GITEA_AUTH_TOKEN=<admin PAT, scope write:organization + write:admin> \
#   ORG_NAME=acme \
#   ORG_DESCRIPTION="Acme Corp homelab" \
#   ORG_VISIBILITY=public \
#   ORG_OWNERS=alice,bob \
#   ORG_MEMBERS=carol \
#     ./create-org.sh
#
# Uso (auth via Basic — fallback para flows interactivos sem PAT pré-criado):
#   GITEA_URL=... \
#   GITEA_USER=alice GITEA_PASSWORD=*** \
#   ORG_NAME=acme ORG_OWNERS=alice \
#     ./create-org.sh
#
# Comportamento:
#   - Org não existe → POST /orgs (description + visibility)
#   - Org existe     → PATCH com description/visibility actuais
#   - Owners CSV     → PUT cada user no team "Owners" (auto-criado pela
#                      Gitea quando a org nasce)
#   - Members CSV    → cria team "Members" (read perm) se não existir,
#                      depois PUT cada user lá
#
# Nota: o user que adicionas não precisa de aceitar invite (PUT na API
# de team members é force-add). Requer admin scope no auth.

set -euo pipefail
: "${GITEA_URL:?must be set}"
: "${ORG_NAME:?must be set}"

ORG_DESCRIPTION="${ORG_DESCRIPTION:-}"
ORG_VISIBILITY="${ORG_VISIBILITY:-public}"  # public | limited | private
ORG_OWNERS="${ORG_OWNERS:-}"
ORG_MEMBERS="${ORG_MEMBERS:-}"

if [ -n "${GITEA_AUTH_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: token $GITEA_AUTH_TOKEN")
elif [ -n "${GITEA_USER:-}" ] && [ -n "${GITEA_PASSWORD:-}" ]; then
  AUTH=(-u "$GITEA_USER:$GITEA_PASSWORD")
  [ -n "${GITEA_OTP:-}" ] && AUTH+=(-H "X-Gitea-OTP: $GITEA_OTP")
else
  echo "create-org: need GITEA_AUTH_TOKEN, or GITEA_USER + GITEA_PASSWORD" >&2
  exit 1
fi

api() {
  curl -fsS "${AUTH[@]}" -H "Content-Type: application/json" "$@"
}

echo "=== Org $ORG_NAME ==="
if api -o /dev/null -w '%{http_code}' "$GITEA_URL/api/v1/orgs/$ORG_NAME" | grep -q '^200$'; then
  echo "  existe — patch description/visibility"
  api -X PATCH "$GITEA_URL/api/v1/orgs/$ORG_NAME" \
    -d "{\"description\":\"$ORG_DESCRIPTION\",\"visibility\":\"$ORG_VISIBILITY\"}" >/dev/null
else
  echo "  criar"
  api -X POST "$GITEA_URL/api/v1/orgs" \
    -d "{\"username\":\"$ORG_NAME\",\"description\":\"$ORG_DESCRIPTION\",\"visibility\":\"$ORG_VISIBILITY\"}" \
    >/dev/null
fi

team_id() {
  local name="$1"
  api "$GITEA_URL/api/v1/orgs/$ORG_NAME/teams?limit=50" \
    | jq -r ".[]|select(.name==\"$name\")|.id" | head -1
}

add_to_team() {
  local team_name="$1" user="$2" tid
  tid=$(team_id "$team_name")
  [ -z "$tid" ] && { echo "  team $team_name não existe (skip $user)" >&2; return 1; }
  api -X PUT -o /dev/null "$GITEA_URL/api/v1/teams/$tid/members/$user"
  echo "  + $user → $team_name"
}

if [ -n "$ORG_OWNERS" ]; then
  echo ""
  echo "=== Owners ==="
  IFS=',' read -ra OWNERS <<< "$ORG_OWNERS"
  for u in "${OWNERS[@]}"; do
    add_to_team Owners "$(echo "$u" | tr -d ' ')"
  done
fi

if [ -n "$ORG_MEMBERS" ]; then
  echo ""
  echo "=== Members ==="
  if [ -z "$(team_id Members)" ]; then
    echo "  criar team Members (read perm em todos os repos)"
    api -X POST "$GITEA_URL/api/v1/orgs/$ORG_NAME/teams" \
      -d '{"name":"Members","permission":"read","includes_all_repositories":true,"can_create_org_repo":false,"units":["repo.code","repo.issues","repo.pulls","repo.releases","repo.wiki"]}' \
      >/dev/null
  fi
  IFS=',' read -ra MEMBERS <<< "$ORG_MEMBERS"
  for u in "${MEMBERS[@]}"; do
    add_to_team Members "$(echo "$u" | tr -d ' ')"
  done
fi

echo ""
echo "✓ org $ORG_NAME pronta — $GITEA_URL/$ORG_NAME"
