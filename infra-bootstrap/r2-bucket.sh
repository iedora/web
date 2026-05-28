#!/usr/bin/env bash
# infra-bootstrap/r2-bucket.sh — DAY 0
#
# Provisiona o R2 bucket `iedora-assets` (uploads do menu: logos, banners,
# QR stickers) + cria token S3-compat scoped + grava as credenciais em BWS.
#
# Totalmente programático via Cloudflare API:
#   - Bucket via /accounts/{acct}/r2/buckets
#   - Token via /user/tokens (R2 bucket-scoped permission groups)
#   - Access Key ID = token.id; Secret Access Key = SHA256(token.value)
#
# Idempotente — re-correr é seguro: skip bucket se existe, skip token se
# as keys BWS já cobrem o bucket alvo.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado
#   - BWS contém CLOUDFLARE_API_TOKEN com User Tokens + R2 admin scope

set -euo pipefail

BUCKET="${BUCKET:-iedora-assets}"
LOCATION_HINT="${LOCATION_HINT:-weur}"
TOKEN_NAME="${TOKEN_NAME:-$BUCKET-rw}"
BWS_KEY_ACCESS_ID="${BWS_KEY_ACCESS_ID:-IEDORA_S3_ACCESS_KEY_ID}"
BWS_KEY_SECRET="${BWS_KEY_SECRET:-IEDORA_S3_SECRET_ACCESS_KEY}"

# R2 permission group UUIDs (estáveis, da CF API):
PG_READ="6a018a9f2fc74eb6b293b0c548f38b39"   # Workers R2 Storage Bucket Item Read
PG_WRITE="2efd5506f9c8494dacb1fa10a3e7d5b6"  # Workers R2 Storage Bucket Item Write

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')

list_bws() {
  bws secret list "$PROJECT_ID" -o json | python3 -c '
import sys, json
for s in json.loads(sys.stdin.read(), strict=False):
    print(s["id"] + "\t" + s["key"])
'
}
bws_id_of() { list_bws | awk -F'\t' -v k="$1" '$2==k {print $1; exit}'; }

CF_TOKEN_ID=$(bws_id_of CLOUDFLARE_API_TOKEN)
[ -z "$CF_TOKEN_ID" ] && { echo "BWS: CLOUDFLARE_API_TOKEN missing" >&2; exit 1; }
CF_TOKEN=$(bws secret get "$CF_TOKEN_ID" -o json | python3 -c 'import sys,json; print(json.loads(sys.stdin.read(),strict=False)["value"])')
CF_ACCT=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" 'https://api.cloudflare.com/client/v4/accounts' | jq -r '.result[0].id')

echo "=== 1. R2 bucket $BUCKET ==="
EXISTS=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets" \
  | jq -r ".result.buckets[]|select(.name==\"$BUCKET\")|.name")

if [ -n "$EXISTS" ]; then
  echo "  bucket existe, skip"
else
  RESP=$(curl -sS -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets" \
    -d "{\"name\":\"$BUCKET\",\"locationHint\":\"$LOCATION_HINT\"}")
  if [ "$(echo "$RESP" | jq -r '.success')" != "true" ]; then
    echo "  FAIL: $RESP" >&2; exit 1
  fi
  echo "  criado em $LOCATION_HINT"
fi

echo ""
echo "=== 2. R2 S3-compat credentials ==="

HAVE_ACCESS=$(bws_id_of "$BWS_KEY_ACCESS_ID")
HAVE_SECRET=$(bws_id_of "$BWS_KEY_SECRET")

if [ -n "$HAVE_ACCESS" ] && [ -n "$HAVE_SECRET" ]; then
  echo "  $BWS_KEY_ACCESS_ID + $BWS_KEY_SECRET já em BWS, skip"
else
  echo "  a criar User API Token com R2 RW scope no bucket..."
  RES="com.cloudflare.edge.r2.bucket.${CF_ACCT}_default_${BUCKET}"
  RESP=$(curl -sS -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    'https://api.cloudflare.com/client/v4/user/tokens' \
    -d "{
      \"name\":\"$TOKEN_NAME\",
      \"policies\":[{
        \"effect\":\"allow\",
        \"resources\":{\"$RES\":\"*\"},
        \"permission_groups\":[{\"id\":\"$PG_READ\"},{\"id\":\"$PG_WRITE\"}]
      }]
    }")
  if [ "$(echo "$RESP" | jq -r '.success')" != "true" ]; then
    echo "  FAIL: $RESP" >&2; exit 1
  fi
  ACCESS_KEY=$(echo "$RESP" | jq -r '.result.id')
  SECRET_KEY=$(printf '%s' "$(echo "$RESP" | jq -r '.result.value')" | shasum -a 256 | awk '{print $1}')

  bws -o json secret create "$BWS_KEY_ACCESS_ID" "$ACCESS_KEY" "$PROJECT_ID" >/dev/null
  bws -o json secret create "$BWS_KEY_SECRET" "$SECRET_KEY" "$PROJECT_ID" >/dev/null
  echo "  token criado + BWS gravado ($BWS_KEY_ACCESS_ID, $BWS_KEY_SECRET)"
fi

echo ""
echo "=== Sumário ==="
echo "  endpoint: https://$CF_ACCT.r2.cloudflarestorage.com"
echo "  region:   auto"
echo "  bucket:   $BUCKET"
echo ""
echo "✓ R2 pronto."
