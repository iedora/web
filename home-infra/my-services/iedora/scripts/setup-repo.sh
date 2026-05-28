#!/usr/bin/env bash
# Iedora-specific. Cria PAT de deploy no Gitea (via create-token.sh
# em modo admin, lê GITEA_ADMIN_PAT do BWS), publica como Actions
# secret, e prepara o Beelink:
#   - /root/.netrc (auth git via HTTPS)
#   - /etc/hosts override (git.iedora.com → 127.0.0.1, Caddy local)
#   - /opt/iedora git clone (ou fetch se já existe)
#
# Idempotent. Sem prompts (consome GITEA_ADMIN_PAT preparado pelo
# home-infra/gitea/scripts/bootstrap-admin-pat.sh).
#
# Pré-requisitos (env):
#   BWS_ACCESS_TOKEN  exportado
#   HOMELAB_HOST      ex: ssh://root@<ip>

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GITEA_UTILS="$HERE/../../../gitea/scripts"
SHARED="$HERE/shared"

: "${HOMELAB_HOST:?must be set}"
: "${BWS_ACCESS_TOKEN:?must be set}"

SSH_TARGET="${HOMELAB_HOST#ssh://}"
# API calls a partir do Mac → endpoint LAN (porta 3030) para não
# depender do tunnel/DNS público. O domain `git.iedora.com` é usado só
# pelo Kamal pull no Beelink (via /etc/hosts loopback) e pelo CI.
GITEA_URL="${GITEA_URL:-http://${SSH_TARGET}:3030}"
GITEA_USER="${GITEA_USER:-eduvhc}"
REPO="${REPO:-eduvhc/iedora}"

# shellcheck source=shared/bws.sh
. "$SHARED/bws.sh"

GITEA_ADMIN_PAT=$(bws_get GITEA_ADMIN_PAT)
[ -n "$GITEA_ADMIN_PAT" ] || { echo "GITEA_ADMIN_PAT missing in BWS — run home-infra/gitea/scripts/bootstrap-admin-pat.sh first" >&2; exit 1; }

GITEA_PASSWORD=$(bws_get GITEA_ADMIN_PASSWORD)
[ -n "$GITEA_PASSWORD" ] || { echo "GITEA_ADMIN_PASSWORD missing in BWS" >&2; exit 1; }

# 1. Gera deploy PAT (scope read:repository + write:package) via
#    create-token.sh em modo Basic (endpoint /users/.../tokens — Gitea
#    1.26 não tem o endpoint admin equivalente).
#    create-token.sh é rotação limpa: revoga + cria sempre.
echo "  → deploy PAT (iedora-deploy)"
PAT=$(
  GITEA_URL="$GITEA_URL" \
  GITEA_USER="$GITEA_USER" \
  GITEA_PASSWORD="$GITEA_PASSWORD" \
  TOKEN_NAME=iedora-deploy \
  TOKEN_SCOPES=read:repository,write:package \
    "$GITEA_UTILS/create-token.sh"
)
echo "  ✓ deploy PAT rotacionado"

REPO_OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

# 1.5. Cria repo `$REPO` se faltar (admin endpoint).
echo "  → repo $REPO"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: token $GITEA_ADMIN_PAT" \
  "$GITEA_URL/api/v1/repos/$REPO")
if [ "$HTTP" = "200" ]; then
  echo "  ✓ repo já existe"
else
  curl -fsS -X POST \
    -H "Authorization: token $GITEA_ADMIN_PAT" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$REPO_NAME\",\"private\":false,\"auto_init\":false,\"default_branch\":\"main\"}" \
    "$GITEA_URL/api/v1/admin/users/$REPO_OWNER/repos" >/dev/null
  echo "  ✓ repo criado"
fi

# 2. Publica o deploy PAT como Actions secret KAMAL_REGISTRY_PASSWORD
#    para o CI poder fazer `docker login git.iedora.com`. Usa o admin PAT
#    para esta API (write:repository scope) — o deploy PAT em si só tem
#    write:package + read:repository.
echo "  → Actions secret KAMAL_REGISTRY_PASSWORD em $REPO"
GITEA_URL="$GITEA_URL" \
GITEA_AUTH_TOKEN="$GITEA_ADMIN_PAT" \
REPO="$REPO" \
SECRET_NAME=KAMAL_REGISTRY_PASSWORD \
SECRET_VALUE="$PAT" \
  "$GITEA_UTILS/set-actions-secret.sh" >/dev/null
echo "  ✓ KAMAL_REGISTRY_PASSWORD publicado"

# Publica BWS_ACCESS_TOKEN para o deploy workflow (que faz ssh-trigger
# ao Beelink). O Kamal no Beelink lê secrets do BWS via `bws run` —
# precisa do mesmo token que o operador usa.
echo "  → Actions secret BWS_ACCESS_TOKEN em $REPO"
GITEA_URL="$GITEA_URL" \
GITEA_AUTH_TOKEN="$GITEA_ADMIN_PAT" \
REPO="$REPO" \
SECRET_NAME=BWS_ACCESS_TOKEN \
SECRET_VALUE="$BWS_ACCESS_TOKEN" \
  "$GITEA_UTILS/set-actions-secret.sh" >/dev/null
echo "  ✓ BWS_ACCESS_TOKEN publicado"

# 3. Beelink: .netrc + /etc/hosts override + git clone
# shellcheck disable=SC2087  # vars expanded client-side, intencional
ssh "$SSH_TARGET" bash <<REMOTE
set -euo pipefail

step() { printf "  → %s" "\$1"; }
ok()   { printf " ✓\n"; }
skip() { printf " (já)\n"; }

step "/root/.netrc"
cat > /root/.netrc <<NETRC
machine git.iedora.com
login $GITEA_USER
password $PAT
NETRC
chmod 600 /root/.netrc
ok

step "/etc/hosts: 127.0.0.1 git.iedora.com"
if grep -qxF '127.0.0.1 git.iedora.com' /etc/hosts; then
  skip
else
  echo '127.0.0.1 git.iedora.com' >> /etc/hosts
  ok
fi

step "/opt/iedora"
if [ -d /opt/iedora/.git ]; then
  (cd /opt/iedora && git fetch origin --prune --quiet)
  printf " ✓ (git fetch)\n"
else
  rm -rf /opt/iedora
  git clone --quiet https://git.iedora.com:4443/$REPO.git /opt/iedora
  printf " ✓ (git clone)\n"
fi
REMOTE
