#!/usr/bin/env bash
# 1 comando para um homelab novo (ou substituição de server).
# Genérico — sem hardcodes de apps/repos. Idempotent.
#
# Pré-requisitos:
#   BWS_ACCESS_TOKEN  exportado
#   HOMELAB_HOST      ex: ssh://root@<ip>
#
# Etapas:
#   1. Server install (apt + Kamal + BWS CLI + SSH loopback key)
#   2. OpenObserve
#   3. Gitea + Caddy + Runner
#   4. Gitea admin PAT (BWS::GITEA_ADMIN_PAT, prompt password 1x)
#   5. Cloudflared (admin tunnel: git.iedora.com + observe.iedora.com)
#
# Pós-bootstrap: ./home-infra/my-services/<app>/scripts/bootstrap.sh

set -euo pipefail
: "${BWS_ACCESS_TOKEN:?must be set}"
: "${HOMELAB_HOST:?must be set, e.g. ssh://root@<ip>}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/.."
export HOMELAB_HOST DOCKER_HOST="$HOMELAB_HOST"

echo "════════════════════════════════════════════════════════════"
echo "home-infra bootstrap — $HOMELAB_HOST"
echo "════════════════════════════════════════════════════════════"

echo ""
echo "=== 1. Server install (apt + Kamal + BWS + SSH key) ==="
"$HERE/install-kamal.sh"

echo ""
echo "=== 2. OpenObserve ==="
"$ROOT/openobserve/bin.sh"

echo ""
echo "=== 3. Gitea + Caddy + Runner ==="
"$ROOT/gitea/bin.sh"

echo ""
echo "=== 4. Gitea admin PAT (BWS::GITEA_ADMIN_PAT) ==="
"$ROOT/gitea/scripts/bootstrap-admin-pat.sh"

echo ""
echo "=== 5. Cloudflared admin tunnel (homelab-admin) ==="
"$ROOT/cloudflared/bin.sh"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ home-infra pronto."
echo "  Próximo: ./home-infra/my-services/<app>/scripts/bootstrap.sh"
echo "════════════════════════════════════════════════════════════"
