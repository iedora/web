#!/usr/bin/env bash
# infra-bootstrap/cloudflare-tunnel.sh — DAY 0
#
# Procedimento day-0 para um homelab novo (Beelink, Mac mini, NUC, etc.):
#
#   1. No homelab novo:
#        - Docker instalado, SSH key do operador autorizada
#        - /etc/resolv.conf resolve domínios externos (sem Tailscale a
#          atravessar-se à frente — se houver, `apt purge tailscale`)
#   2. config/deploy.production.yml: editar `servers.web[0]` para o IP LAN
#      do novo homelab
#   3. **Correr este script** (cria CF Tunnel + ingress + DNS + guarda
#      token em BWS como IEDORA_TUNNEL_TOKEN)
#   4. `kamal setup -d production` — boot do kamal-proxy, postgres,
#      cloudflared (que consome o token gravado no passo 3), e app
#
# Idempotente: se o tunnel `iedora-beelink` já existir, reutiliza-o em vez
# de criar novo. Re-correr depois de mudar de homelab apenas re-emite o
# token e reaponta os CNAMEs — sem efeito destrutivo nos hostnames.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado na shell
#   - BWS contém CLOUDFLARE_API_TOKEN com Tunnel+DNS scopes
#   - Zone `iedora.com` activa na conta Cloudflare

set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-iedora-beelink}"
ZONE_NAME="${ZONE_NAME:-iedora.com}"
HOSTS=(iedora.com www.iedora.com menu.iedora.com core.iedora.com imopush.iedora.com)
SERVICE_TARGET="${SERVICE_TARGET:-http://kamal-proxy:80}"

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')
CF_TOKEN=$(bws secret list "$PROJECT_ID" -o json | jq -r '.[]|select(.key=="CLOUDFLARE_API_TOKEN")|.value')
CF_ACCT=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" 'https://api.cloudflare.com/client/v4/accounts' | jq -r '.result[0].id')
ZONE_ID=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | jq -r '.result[0].id')

[ "$ZONE_ID" = "null" ] && { echo "Zone $ZONE_NAME não encontrada"; exit 1; }

EXISTING=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/cfd_tunnel?is_deleted=false" \
  | jq -r ".result[]|select(.name==\"$TUNNEL_NAME\")|.id" | head -1)

if [ -n "$EXISTING" ]; then
  TUNNEL_ID="$EXISTING"
  echo "Tunnel $TUNNEL_NAME já existe ($TUNNEL_ID), reutilizando."
  TOKEN_RESP=$(curl -sS -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/cfd_tunnel/$TUNNEL_ID/token")
  TUNNEL_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.result // empty')
  [ -z "$TUNNEL_TOKEN" ] && { echo "Falhou a obter token do tunnel existente: $TOKEN_RESP"; exit 1; }
else
  echo "A criar tunnel $TUNNEL_NAME..."
  TUNNEL_SECRET=$(openssl rand -base64 32)
  RESP=$(curl -sS -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/cfd_tunnel" \
    -d "{\"name\":\"$TUNNEL_NAME\",\"tunnel_secret\":\"$TUNNEL_SECRET\",\"config_src\":\"cloudflare\"}")
  TUNNEL_ID=$(echo "$RESP" | jq -r '.result.id // empty')
  TUNNEL_TOKEN=$(echo "$RESP" | jq -r '.result.token // empty')
  [ -z "$TUNNEL_ID" ] && { echo "Falhou: $RESP"; exit 1; }
fi

echo "Tunnel ID: $TUNNEL_ID"

INGRESS='['
for H in "${HOSTS[@]}"; do
  INGRESS+="{\"hostname\":\"$H\",\"service\":\"$SERVICE_TARGET\"},"
done
INGRESS+='{"service":"http_status:404"}]'

echo "A configurar ingress..."
curl -sS -X PUT -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/cfd_tunnel/$TUNNEL_ID/configurations" \
  -d "{\"config\":{\"ingress\":$INGRESS}}" | jq -c '{success, errors: (.errors // [])}'

echo "A repoint DNS records..."
TARGET="$TUNNEL_ID.cfargotunnel.com"
for NAME in "${HOSTS[@]}"; do
  REC=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$NAME" | jq -r '.result[0]')
  REC_ID=$(echo "$REC" | jq -r '.id')
  if [ "$REC_ID" = "null" ] || [ -z "$REC_ID" ]; then
    curl -sf -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
      "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
      -d "{\"type\":\"CNAME\",\"name\":\"$NAME\",\"content\":\"$TARGET\",\"proxied\":true}" \
      | jq -c "{action: \"create\", name: .result.name}"
  else
    curl -sf -X PUT -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
      "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$REC_ID" \
      -d "{\"type\":\"CNAME\",\"name\":\"$NAME\",\"content\":\"$TARGET\",\"proxied\":true}" \
      | jq -c "{action: \"update\", name: .result.name}"
  fi
done

echo "A guardar IEDORA_TUNNEL_TOKEN em BWS..."
EXISTING_SEC=$(bws secret list "$PROJECT_ID" -o json | jq -r '.[]|select(.key=="IEDORA_TUNNEL_TOKEN")|.id' | head -1)
if [ -n "$EXISTING_SEC" ]; then
  CURRENT_VAL=$(bws secret get "$EXISTING_SEC" -o json | jq -r '.value')
  if [ "$CURRENT_VAL" = "$TUNNEL_TOKEN" ]; then
    echo "BWS: IEDORA_TUNNEL_TOKEN já tem o valor correcto (no-op)"
  else
    bws secret edit "$EXISTING_SEC" --value "$TUNNEL_TOKEN" >/dev/null
    echo "BWS: update IEDORA_TUNNEL_TOKEN"
  fi
else
  bws secret create IEDORA_TUNNEL_TOKEN "$TUNNEL_TOKEN" "$PROJECT_ID" >/dev/null
  echo "BWS: create IEDORA_TUNNEL_TOKEN"
fi

echo ""
echo "✓ Tunnel pronto. Próximo: kamal accessory boot cloudflared -d production"
