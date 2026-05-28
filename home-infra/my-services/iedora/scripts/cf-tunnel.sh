#!/usr/bin/env bash
# home-infra/my-services/iedora/scripts/cf-tunnel.sh
#
# Provisiona o tunnel `iedora-public` (traffic público anónimo) no
# Cloudflare:
#   - Apaga tunnel legacy `iedora-beelink` se existir (migration one-shot)
#   - Cria/reutiliza tunnel iedora-public
#   - Ingress: iedora.com + subdomínios → http://kamal-proxy:80
#   - DNS CNAMEs proxied
#   - Guarda token em BWS como IEDORA_TUNNEL_TOKEN
#
# Idempotente. Pré-requisitos: BWS_ACCESS_TOKEN + BWS contém
# CLOUDFLARE_API_TOKEN.
#
# Traffic anónimo (sign-in nativo da app onde aplicável). Para admin
# (gitea, OO) ver home-infra/cloudflared/.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../cloudflared/.env
. "$HERE/../cloudflared/.env"
: "${TUNNEL_NAME:?TUNNEL_NAME must be set in cloudflared/.env}"
: "${ZONE_NAME:?ZONE_NAME must be set in cloudflared/.env}"

LEGACY_TUNNEL_NAME="${LEGACY_TUNNEL_NAME:-iedora-beelink}"

HOSTS=(iedora.com www.iedora.com menu.iedora.com core.iedora.com imopush.iedora.com)
# kamal-proxy vive na network `kamal` (mantida pelo Kamal); o connector
# vive na `homelab-core` — não há Docker DNS entre eles. Saída pelo
# host gateway (`host.docker.internal:host-gateway` no compose) → porta
# publicada no host (3001, ver deploy.yml `proxy.run.http_port`).
SERVICE_TARGET="${SERVICE_TARGET:-http://host.docker.internal:3001}"

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

SHARED="$HERE/shared"
# shellcheck source=shared/bws.sh
. "$SHARED/bws.sh"
CF_TOKEN=$(bws_get CLOUDFLARE_API_TOKEN)
export CF_TOKEN

# shellcheck source=shared/cf.sh
. "$SHARED/cf.sh"

CF_ACCT=$(cf_account_id)
ZONE_ID=$(cf_zone_id "$ZONE_NAME")
[ -z "$ZONE_ID" ] && { echo "Zone $ZONE_NAME não encontrada" >&2; exit 1; }

echo "=== Legacy cleanup ==="
tunnel_delete_if_exists "$CF_ACCT" "$LEGACY_TUNNEL_NAME"

echo ""
echo "=== Tunnel $TUNNEL_NAME ==="
TUNNEL_OUT=$(tunnel_upsert "$CF_ACCT" "$TUNNEL_NAME")
TUNNEL_ID=$(echo "$TUNNEL_OUT" | cut -f1)
TUNNEL_TOKEN=$(echo "$TUNNEL_OUT" | cut -f2)
echo "Tunnel ID: $TUNNEL_ID"

echo ""
echo "=== Ingress ==="
INGRESS_JSON='['
for H in "${HOSTS[@]}"; do
  INGRESS_JSON+="{\"hostname\":\"$H\",\"service\":\"$SERVICE_TARGET\"},"
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
bws_secret_upsert IEDORA_TUNNEL_TOKEN "$TUNNEL_TOKEN"

echo ""
echo "✓ Tunnel $TUNNEL_NAME pronto. Next: cloudflared/bin.sh para boot do connector."
