#!/usr/bin/env bash
# home-infra/cloudflared/scripts/provision.sh
#
# Provisiona o tunnel `homelab-admin` no Cloudflare:
#   - Cria/reutiliza o tunnel
#   - Ingress: git.iedora.com → gitea, observe.iedora.com → openobserve
#   - DNS CNAMEs proxied
#   - Guarda token em BWS como HOMELAB_ADMIN_TUNNEL_TOKEN
#
# Idempotente. Pré-requisitos: BWS_ACCESS_TOKEN + BWS contém CLOUDFLARE_API_TOKEN.
#
# Sem auth gating à frente do tunnel — Gitea e OpenObserve têm o seu próprio
# sign-in. SSO via Authentik está planeado mas ainda não implementado.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/shared"

# shellcheck source=../.env
. "$HERE/../.env"
: "${TUNNEL_NAME:?TUNNEL_NAME must be set in home-infra/cloudflared/.env}"
: "${ZONE_NAME:?ZONE_NAME must be set in home-infra/cloudflared/.env}"

# Ingress: parallel arrays (HOSTS[i] → SERVICES[i]). Não usamos
# `declare -A` (assoc arrays) porque o /bin/bash do macOS é 3.2 e não
# suporta — quebra com "invalid arithmetic operator".
HOSTS=("git.iedora.com" "observe.iedora.com")
SERVICES=("http://gitea:3000" "http://openobserve:5080")

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

# shellcheck source=shared/bws.sh
. "$SHARED/bws.sh"
CF_TOKEN=$(bws_get CLOUDFLARE_API_TOKEN)
export CF_TOKEN

# shellcheck source=shared/cf.sh
. "$SHARED/cf.sh"

CF_ACCT=$(cf_account_id)
ZONE_ID=$(cf_zone_id "$ZONE_NAME")
[ -z "$ZONE_ID" ] && { echo "Zone $ZONE_NAME não encontrada" >&2; exit 1; }

echo "=== Tunnel $TUNNEL_NAME ==="
TUNNEL_OUT=$(tunnel_upsert "$CF_ACCT" "$TUNNEL_NAME")
TUNNEL_ID=$(echo "$TUNNEL_OUT" | cut -f1)
TUNNEL_TOKEN=$(echo "$TUNNEL_OUT" | cut -f2)
echo "Tunnel ID: $TUNNEL_ID"

echo ""
echo "=== Ingress ==="
INGRESS_JSON='['
for i in "${!HOSTS[@]}"; do
  INGRESS_JSON+="{\"hostname\":\"${HOSTS[$i]}\",\"service\":\"${SERVICES[$i]}\"},"
done
INGRESS_JSON+='{"service":"http_status:404"}]'
ingress_put "$CF_ACCT" "$TUNNEL_ID" "$INGRESS_JSON"

echo ""
echo "=== DNS records ==="
for H in "${HOSTS[@]}"; do
  dns_cname_upsert "$ZONE_ID" "$H" "$TUNNEL_ID.cfargotunnel.com"
done

echo ""
echo "=== BWS ==="
bws_secret_upsert HOMELAB_ADMIN_TUNNEL_TOKEN "$TUNNEL_TOKEN"

echo ""
echo "✓ Tunnel $TUNNEL_NAME pronto. Next: bin.sh para boot do connector."
