#!/usr/bin/env bash
# 1 comando para bootstrapar a app iedora. Assume que `home-infra/`
# já correu (kamal + bws + openobserve + gitea + cloudflared admin +
# GITEA_ADMIN_PAT em BWS).
# Idempotent. Zero prompts.
#
# Etapas:
#   1. CF tunnel iedora-public + DNS
#   2. Connector iedora-public (compose)
#   3. R2 bucket + S3 creds em BWS
#   4. Org `iedora` no Gitea + Owner
#   5. Deploy PAT + .netrc + /etc/hosts + /opt/iedora clone +
#      KAMAL_REGISTRY_PASSWORD Actions secret
#
# Pré-requisitos (env):
#   BWS_ACCESS_TOKEN  exportado
#   HOMELAB_HOST      ex: ssh://root@<ip>
#
# Pós-bootstrap: primeiro deploy via CI (push a `main`).

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/shared"

: "${BWS_ACCESS_TOKEN:?must be set}"
: "${HOMELAB_HOST:?must be set}"
export DOCKER_HOST="$HOMELAB_HOST"

# shellcheck source=shared/bws.sh
. "$SHARED/bws.sh"
GITEA_ADMIN_PAT=$(bws_get GITEA_ADMIN_PAT)
[ -n "$GITEA_ADMIN_PAT" ] || { echo "GITEA_ADMIN_PAT missing in BWS — run home-infra/scripts/bootstrap.sh first" >&2; exit 1; }

echo "════════════════════════════════════════════════════════════"
echo "iedora bootstrap — $HOMELAB_HOST"
echo "════════════════════════════════════════════════════════════"

echo ""
echo "=== 1. CF tunnel iedora-public + DNS ==="
"$HERE/cf-tunnel.sh"

echo ""
echo "=== 2. Connector iedora-public ==="
"$HERE/../cloudflared/bin.sh"

echo ""
echo "=== 3. R2 bucket iedora-assets ==="
"$HERE/r2-bucket.sh"

echo ""
echo "=== 4. Gitea org iedora + Owner ==="
# Usa LAN URL (porta 3030 directa) para não depender do tunnel/DNS estarem
# propagados. O domain público resolve depois.
GITEA_LAN_URL="http://$(echo "$HOMELAB_HOST" | sed -E 's|^ssh://[^@]+@||'):3030"
GITEA_URL="${GITEA_URL:-$GITEA_LAN_URL}" \
GITEA_AUTH_TOKEN="$GITEA_ADMIN_PAT" \
ORG_NAME=iedora \
ORG_DESCRIPTION="iedora apps" \
ORG_VISIBILITY=public \
ORG_OWNERS="${GITEA_USER:-eduvhc}" \
  "$HERE/../../../gitea/scripts/create-org.sh"

echo ""
echo "=== 5. Deploy PAT + repo setup ==="
"$HERE/setup-repo.sh"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ iedora pronto."
echo "  Próximo: primeiro deploy via CI (push a main)."
echo "════════════════════════════════════════════════════════════"
