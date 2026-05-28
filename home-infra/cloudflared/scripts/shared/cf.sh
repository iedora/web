#!/usr/bin/env bash
# <service>/scripts/shared/cf.sh — Cloudflare API helpers (idempotent).
#
# Contrato:
#   - Caller exporta CF_TOKEN (Cloudflare API token com Tunnel + DNS scope)
#   - Funções fazem fail-fast em respostas sem `.success: true`
#   - `set -e` do caller propaga erros
#
# Funções expostas:
#   cf <curl-args...>               curl wrapper (auth + content-type)
#   cf_account_id                   echo CF account id (primeiro da lista)
#   cf_zone_id <name>               echo zone id de <name>
#   tunnel_upsert <acct> <name>     echo "<id>\t<token>"
#   tunnel_delete_if_exists <acct> <name>
#   ingress_put <acct> <id> <ingress-json>
#   dns_cname_upsert <zone> <name> <target>

: "${CF_TOKEN:?CF_TOKEN must be exported by caller}"

cf() {
  curl -sS -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" "$@"
}

cf_account_id() {
  cf 'https://api.cloudflare.com/client/v4/accounts' | jq -r '.result[0].id'
}

cf_zone_id() {
  cf "https://api.cloudflare.com/client/v4/zones?name=$1" | jq -r '.result[0].id // empty'
}

tunnel_upsert() {
  local acct="$1" name="$2" id token
  id=$(cf "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel?is_deleted=false" \
    | jq -r ".result[]|select(.name==\"$name\")|.id" | head -1)

  if [ -n "$id" ]; then
    token=$(cf "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel/$id/token" | jq -r '.result // empty')
    [ -z "$token" ] && { echo "tunnel_upsert: falhou obter token de $name ($id)" >&2; return 1; }
    echo "  ✓ tunnel $name (já existe)" >&2
  else
    local secret resp
    secret=$(openssl rand -base64 32)
    resp=$(cf -X POST "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel" \
      -d "{\"name\":\"$name\",\"tunnel_secret\":\"$secret\",\"config_src\":\"cloudflare\"}")
    [ "$(echo "$resp" | jq -r '.success')" = "true" ] || { echo "tunnel_upsert: $resp" >&2; return 1; }
    id=$(echo "$resp" | jq -r '.result.id')
    token=$(echo "$resp" | jq -r '.result.token')
    echo "  → tunnel $name criado" >&2
  fi
  printf '%s\t%s\n' "$id" "$token"
}

tunnel_delete_if_exists() {
  local acct="$1" name="$2" id
  id=$(cf "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel?is_deleted=false" \
    | jq -r ".result[]|select(.name==\"$name\")|.id" | head -1)
  [ -z "$id" ] && return 0
  cf -X DELETE "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel/$id?cascade=true" \
    | jq -e '.success' >/dev/null || { echo "tunnel_delete_if_exists: falhou apagar $name" >&2; return 1; }
  echo "Tunnel apagado: $name ($id)"
}

ingress_put() {
  local acct="$1" tunnel_id="$2" ingress_json="$3"
  cf -X PUT "https://api.cloudflare.com/client/v4/accounts/$acct/cfd_tunnel/$tunnel_id/configurations" \
    -d "{\"config\":{\"ingress\":$ingress_json}}" \
    | jq -e '.success' >/dev/null || { echo "ingress_put falhou para $tunnel_id" >&2; return 1; }
}

dns_cname_upsert() {
  local zone="$1" name="$2" target="$3" rec_id action
  rec_id=$(cf "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?name=$name" | jq -r '.result[0].id // empty')
  if [ -z "$rec_id" ]; then
    action=POST
    cf -X POST "https://api.cloudflare.com/client/v4/zones/$zone/dns_records" \
      -d "{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$target\",\"proxied\":true}" \
      | jq -e '.success' >/dev/null
  else
    action=PUT
    cf -X PUT "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$rec_id" \
      -d "{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$target\",\"proxied\":true}" \
      | jq -e '.success' >/dev/null
  fi
  echo "DNS $action $name → $target"
}

