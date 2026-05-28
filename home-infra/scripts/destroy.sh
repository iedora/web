#!/usr/bin/env bash
# FULL WIPE — destrói tudo para um bootstrap from-scratch.
#
# Apaga:
#   - CF tunnels (iedora-beelink, iedora-public, homelab-admin)
#   - CF DNS records dos hostnames iedora + admin
#   - CF R2 bucket iedora-assets (incl. todos os objects)
#   - BWS secrets: IEDORA_TUNNEL_TOKEN, HOMELAB_ADMIN_TUNNEL_TOKEN,
#     GITEA_ADMIN_PAT, IEDORA_S3_ACCESS_KEY_ID, IEDORA_S3_SECRET_ACCESS_KEY
#   - Beelink: kamal remove + docker compose down -v de todos os
#     home-infra composes + remove network homelab-core + /opt/iedora +
#     /etc/hosts override + .netrc + ci_ed25519 keys
#
# Mantém:
#   - Resto dos BWS secrets (AUTH_SECRET, POSTGRES_PASSWORD, OPENOBSERVE_*,
#     CORE_*, MENU_*, IMOPUSH_*, OTEL_AUTH_HEADER, CLOUDFLARE_API_TOKEN)
#   - Kamal + Ruby + BWS CLI instalados no Beelink (apt-installed, persiste)
#   - Conta CF, zone iedora.com
#
# Pré-requisitos: BWS_ACCESS_TOKEN, HOMELAB_HOST.
# Idempotente: re-correr é seguro, mostra "✓ já limpo" para secções
# sem nada a apagar.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/../cloudflared/scripts/shared"

: "${BWS_ACCESS_TOKEN:?must be set}"
: "${HOMELAB_HOST:?must be set, e.g. ssh://root@<ip>}"
SSH_TARGET="${HOMELAB_HOST#ssh://}"

# shellcheck source=../cloudflared/scripts/shared/bws.sh
. "$SHARED/bws.sh"
CF_TOKEN=$(bws_get CLOUDFLARE_API_TOKEN)
[ -n "$CF_TOKEN" ] || { echo "CLOUDFLARE_API_TOKEN missing in BWS" >&2; exit 1; }
export CF_TOKEN

# shellcheck source=../cloudflared/scripts/shared/cf.sh
. "$SHARED/cf.sh"

CF_ACCT=$(cf_account_id)
ZONE_ID=$(cf_zone_id iedora.com)

echo "════════════════════════════════════════════════════════════"
echo "FULL WIPE — Ctrl-C agora se mudaste de ideia (3s)"
echo "════════════════════════════════════════════════════════════"
sleep 3

echo ""
echo "=== 1. CF Tunnels ==="
N=0
for T in iedora-beelink iedora-public homelab-admin; do
  ID=$(cf "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/cfd_tunnel?is_deleted=false" \
    | jq -r ".result[]|select(.name==\"$T\")|.id" | head -1)
  if [ -n "$ID" ]; then
    tunnel_delete_if_exists "$CF_ACCT" "$T"
    N=$((N+1))
  fi
done
[ $N -eq 0 ] && echo "  ✓ já limpo (0 tunnels)" || echo "  → $N apagados"

echo ""
echo "=== 2. CF DNS records ==="
N=0
for NAME in iedora.com www.iedora.com menu.iedora.com core.iedora.com imopush.iedora.com git.iedora.com observe.iedora.com; do
  REC_ID=$(cf "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$NAME" | jq -r '.result[0].id // empty')
  if [ -n "$REC_ID" ]; then
    cf -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$REC_ID" >/dev/null
    echo "  apagado: $NAME"
    N=$((N+1))
  fi
done
[ $N -eq 0 ] && echo "  ✓ já limpo (0 records)" || echo "  → $N apagados"

echo ""
echo "=== 3. CF R2 bucket iedora-assets ==="
BUCKET=iedora-assets
EXISTS=$(cf "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets" \
  | jq -r ".result.buckets[]|select(.name==\"$BUCKET\")|.name")
if [ -n "$EXISTS" ]; then
  CURSOR=""
  TOTAL=0
  while :; do
    URL="https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets/$BUCKET/objects"
    [ -n "$CURSOR" ] && URL="$URL?cursor=$CURSOR"
    RESP=$(cf "$URL")
    KEYS=$(echo "$RESP" | jq -r '.result[]?.key // empty')
    [ -z "$KEYS" ] && break
    while IFS= read -r K; do
      cf -X DELETE "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets/$BUCKET/objects/$K" >/dev/null
      TOTAL=$((TOTAL+1))
    done <<< "$KEYS"
    CURSOR=$(echo "$RESP" | jq -r '.result_info.cursor // empty')
    [ -z "$CURSOR" ] && break
  done
  cf -X DELETE "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets/$BUCKET" >/dev/null
  echo "  → bucket apagado ($TOTAL objects)"
else
  echo "  ✓ já limpo (bucket não existe)"
fi

echo ""
echo "=== 4. BWS secrets seleccionados ==="
PID=$(bws_project_id)
N=0
for K in IEDORA_TUNNEL_TOKEN HOMELAB_ADMIN_TUNNEL_TOKEN GITEA_ADMIN_PAT IEDORA_S3_ACCESS_KEY_ID IEDORA_S3_SECRET_ACCESS_KEY; do
  SID=$(bws secret list "$PID" -o json | jq -r ".[]|select(.key==\"$K\")|.id" | head -1)
  if [ -n "$SID" ]; then
    bws secret delete "$SID" >/dev/null
    echo "  apagado: $K"
    N=$((N+1))
  fi
done
[ $N -eq 0 ] && echo "  ✓ já limpo (0 secrets)" || echo "  → $N apagados"

echo ""
echo "=== 5. Beelink: Kamal + containers + volumes + /opt/iedora ==="
# shellcheck disable=SC2087
ssh "$SSH_TARGET" bash <<'REMOTE'
set -uo pipefail

step() { printf "  → %s" "$1"; }
ok()   { printf " ✓\n"; }
skip() { printf " (já limpo)\n"; }

# kamal remove (só se /opt/iedora existe — significa setup-repo já correu)
if [ -d /opt/iedora ] && command -v kamal >/dev/null; then
  step "kamal remove"
  (cd /opt/iedora && BWS_ACCESS_TOKEN="${BWS_ACCESS_TOKEN:-}" kamal remove -d production -y >/dev/null 2>&1) && ok || ok
else
  step "kamal remove"; skip
fi

# docker compose down -v em cada home-infra service
DOWN=0
for d in /opt/iedora/home-infra/openobserve /opt/iedora/home-infra/gitea /opt/iedora/home-infra/cloudflared /opt/iedora/home-infra/my-services/iedora/cloudflared; do
  if [ -f "$d/docker-compose.yml" ]; then
    (cd "$d" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
    DOWN=$((DOWN+1))
  fi
done
step "home-infra composes down -v"
if [ $DOWN -eq 0 ]; then skip; else printf " ✓ (%d composes)\n" $DOWN; fi

# Containers órfãos com prefixos conhecidos
CIDS=$(docker ps -aq \
  --filter "name=iedora-" \
  --filter "name=gitea" \
  --filter "name=openobserve" \
  --filter "name=homelab-admin" \
  --filter "name=kamal-proxy" 2>/dev/null | sort -u)
step "containers órfãos"
if [ -n "$CIDS" ]; then
  N=$(echo "$CIDS" | wc -l | tr -d ' ')
  echo "$CIDS" | xargs -r docker rm -f >/dev/null
  printf " ✓ (%d removidos)\n" "$N"
else
  skip
fi

# Volumes
VOLS=$(docker volume ls -q | grep -E "^(iedora|gitea|openobserve|homelab-admin|homelab-core-infra)" || true)
step "volumes órfãos"
if [ -n "$VOLS" ]; then
  N=$(echo "$VOLS" | wc -l | tr -d ' ')
  echo "$VOLS" | xargs -r docker volume rm -f >/dev/null
  printf " ✓ (%d removidos)\n" "$N"
else
  skip
fi

# Network homelab-core
step "network homelab-core"
if docker network inspect homelab-core >/dev/null 2>&1; then
  docker network rm homelab-core >/dev/null 2>&1 && ok || ok
else
  skip
fi

# /opt/iedora
step "/opt/iedora"
if [ -d /opt/iedora ]; then rm -rf /opt/iedora; ok; else skip; fi

# /etc/hosts override
step "/etc/hosts override"
if grep -q 'git\.iedora\.com' /etc/hosts; then
  sed -i '/git\.iedora\.com/d' /etc/hosts; ok
else
  skip
fi

# .netrc
step "/root/.netrc"
if [ -f /root/.netrc ]; then rm -f /root/.netrc; ok; else skip; fi

# ci_ed25519 keys
step "/root/.ssh/ci_ed25519*"
if [ -f /root/.ssh/ci_ed25519 ] || [ -f /root/.ssh/ci_ed25519.pub ]; then
  rm -f /root/.ssh/ci_ed25519 /root/.ssh/ci_ed25519.pub
  sed -i '/ci_ed25519/d' /root/.ssh/authorized_keys 2>/dev/null || true
  ok
else
  skip
fi
REMOTE

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ WIPE COMPLETO. Para re-bootstrap:"
echo "    ./home-infra/scripts/bootstrap.sh"
echo "    ./home-infra/my-services/iedora/scripts/bootstrap.sh"
echo "════════════════════════════════════════════════════════════"
