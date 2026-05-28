#!/usr/bin/env bash
# Boot homelab-core-infra. Secrets vivem em BWS; este script materializa-os
# para um `.env` efémero e corre `docker compose up -d`. Idempotente.
#
# Local (Mac dev, sem `extras`, só OpenObserve):
#   ./homelab-core-infra/up.sh
#
# Remote (Beelink/homelab, com `extras` → openobserve + gitea + runner +
# config do registry LAN-direct para Kamal builder/deploy):
#   ./homelab-core-infra/up.sh --host ssh://root@192.168.50.53
#
# Bootstrap do PAT de CI (gera `eduvhc/kamal-ci-*` no Gitea + publica
# como Actions secret `KAMAL_REGISTRY_PASSWORD` na repo). Requer prompt
# de password do `eduvhc`. Idempotente (revoga PATs antigos com mesmo
# prefix antes de criar novo).
#   ./homelab-core-infra/up.sh --host ssh://root@192.168.50.53 --bootstrap-ci
#
# Usa `DOCKER_HOST=ssh://...` — o daemon remoto recebe os comandos como se
# fosse local. `configs:` no compose viaja em-band, dispensando scp.
#
# Pré-requisitos:
#   - BWS_ACCESS_TOKEN exportado
#   - Para --host: SSH key carregada no agent + docker daemon no host remoto
#   - Para --bootstrap-ci: Gitea acessível em $GITEA_URL (default
#     https://git.iedora.com), curl + jq locais, password do eduvhc
#   - BWS: OPENOBSERVE_ADMIN_PASSWORD

set -euo pipefail

HOST=""
BOOTSTRAP_CI=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --bootstrap-ci) BOOTSTRAP_CI=1; shift ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

: "${BWS_ACCESS_TOKEN:?BWS_ACCESS_TOKEN must be set}"

PROJECT_ID=$(bws project list -o json | jq -r '.[0].id')
SECRETS=$(bws secret list "$PROJECT_ID" -o json)
get() { echo "$SECRETS" | jq -r ".[]|select(.key==\"$1\")|.value"; }

ZO_EMAIL="eduardoferdcarvalho@gmail.com"
ZO_PASS=$(get OPENOBSERVE_ADMIN_PASSWORD)
if [ -z "$ZO_PASS" ]; then
  echo "BWS key em falta: OPENOBSERVE_ADMIN_PASSWORD" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# `.env` é sempre materializado localmente; com DOCKER_HOST=ssh://, o
# `docker compose` resolve env-files no cliente (local) e injecta os
# valores nos containers remotos via API. Não precisa de viajar.
( cd "$HERE" && umask 077 && cat > .env <<EOF
ZO_ROOT_USER_EMAIL=${ZO_EMAIL}
ZO_ROOT_USER_PASSWORD=${ZO_PASS}
EOF
)

COMPOSE_ARGS=(-f "$HERE/docker-compose.yml")
if [ -n "$HOST" ]; then
  echo "→ remote ($HOST): docker compose --profile extras up -d"
  export DOCKER_HOST="$HOST"
  COMPOSE_ARGS+=(--profile extras)
else
  echo "→ local: docker compose up -d (sem extras)"
fi

docker compose "${COMPOSE_ARGS[@]}" up -d

echo "✓ homelab-core-infra up."

# ── Beelink-side setup para Kamal correr localmente ─────────────────────
# Kamal corre directamente no Beelink (CI faz `ssh root@beelink kamal
# deploy`). Usa Kamal Local Registry (feature nativa 2.8+): spawna
# automaticamente um `registry:2` container em `localhost:5000` para
# push/pull intra-host. Sem TLS hacks, sem insecure-registries
# config, sem dependências CF/Gitea para o registry.
#
# Idempotent — cada passo aplica só se ainda não está aplicado:
#   1. ruby + build toolchain (gem ed25519 tem extensão C nativa)
#   2. kamal gem 2.11.0 (skip se já instalado)
#   3. bws CLI (Kamal usa `kamal secrets fetch --adapter bitwarden-sm`)
#   4. /opt/iedora directory (CI vai rsync source para aí)
#   5. SSH loopback keypair em /root/.ssh/ci_ed25519 + authorized_keys
#      (Kamal local faz ssh root@self; runner bind-monta esta chave)
#   6. Cleanup de builders/configs do método antigo (Gitea registry)
if [ -n "$HOST" ]; then
  KAMAL_VERSION="${KAMAL_VERSION:-2.11.0}"
  BWS_VERSION="${BWS_VERSION:-0.5.0}"
  SSH_TARGET="${HOST#ssh://}"
  echo "→ Setup Beelink (Kamal $KAMAL_VERSION, BWS $BWS_VERSION, local registry)"
  ssh "$SSH_TARGET" KAMAL_VERSION="$KAMAL_VERSION" BWS_VERSION="$BWS_VERSION" bash <<'REMOTE'
set -euo pipefail

# 1. Ruby + build toolchain (necessário para o gem ed25519 compilar)
if ! command -v gem >/dev/null || ! command -v gcc >/dev/null; then
  echo "  → apt install ruby + build toolchain"
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    ca-certificates ruby ruby-dev build-essential
else
  echo "  ✓ ruby + build toolchain presentes"
fi

# 2. Kamal gem (scope global, root user)
if ! gem list -i kamal -v "$KAMAL_VERSION" >/dev/null 2>&1; then
  echo "  → gem install kamal -v $KAMAL_VERSION"
  gem install --no-document kamal -v "$KAMAL_VERSION"
else
  echo "  ✓ kamal $KAMAL_VERSION já instalado"
fi
kamal version | sed 's/^/  /'

# 3. BWS CLI — Kamal usa para o `kamal secrets fetch --adapter
#    bitwarden-sm` (lê secrets de produção em runtime).
if ! command -v bws >/dev/null || ! bws --version 2>&1 | grep -q "$BWS_VERSION"; then
  echo "  → install bws CLI $BWS_VERSION"
  apt-get install -y -qq --no-install-recommends unzip curl
  curl -fsSL "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-x86_64-unknown-linux-gnu-${BWS_VERSION}.zip" -o /tmp/bws.zip
  unzip -q -o /tmp/bws.zip -d /tmp/bws
  install -m 0755 /tmp/bws/bws /usr/local/bin/bws
  rm -rf /tmp/bws /tmp/bws.zip
else
  echo "  ✓ bws CLI $BWS_VERSION já instalado"
fi
bws --version 2>&1 | sed 's/^/  /'

# 4. /opt/iedora — destino do rsync da source code
mkdir -p /opt/iedora
chmod 700 /opt/iedora

# 5. SSH loopback keypair — Kamal local no Beelink faz `ssh root@self`
#    para deploys; o CI runner (container no mesmo host) bind-monta esta
#    chave para fazer rsync + ssh trigger. Generated com `-N ""` para
#    não ter passphrase (acesso loopback non-interactive).
#    Idempotent: skip se já existir e tiver perms 0600.
SSH_KEY=/root/.ssh/ci_ed25519
mkdir -p /root/.ssh
chmod 700 /root/.ssh
# Se for um directório (criado por bind-mount Docker em runs anteriores), limpa.
[ -d "$SSH_KEY" ] && rm -rf "$SSH_KEY"
if [ ! -f "$SSH_KEY" ]; then
  ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "iedora-loopback-ci" -q
  echo "  + nova keypair SSH loopback gerada"
fi
chmod 600 "$SSH_KEY"
PUB=$(cat "${SSH_KEY}.pub")
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || {
  echo "$PUB" >> /root/.ssh/authorized_keys
  echo "  + public key autorizada em authorized_keys"
}

# 6. Cleanup: artefactos do método antigo (Gitea registry + buildkit
#    workarounds) já não usados com Kamal Local Registry.
docker buildx ls 2>/dev/null | awk '/^kamal-/{print $1}' | xargs -r -n1 docker buildx rm 2>/dev/null || true
rm -f /root/.docker/buildx/buildkitd.toml /etc/buildkit/buildkitd.toml
REMOTE
  echo "✓ Beelink ready (Kamal local + /opt/iedora)"
fi

# ── Optional: bootstrap CI registry PAT + Actions secret ────────────────
# Roda PAT do `eduvhc` (revoga prefixos `kamal-ci-*`, cria novo) e
# publica como Actions secret `KAMAL_REGISTRY_PASSWORD` na repo
# `eduvhc/iedora` — Kamal usa para `docker login git.iedora.com`. Não
# vive em BWS porque é auth interna entre serviços do mesmo homelab.
if [ "$BOOTSTRAP_CI" = "1" ]; then
  GITEA_URL="${GITEA_URL:-https://git.iedora.com}"
  GITEA_USER="${GITEA_USER:-eduvhc}"
  REPO="${REPO:-eduvhc/iedora}"
  TOKEN_PREFIX="kamal-ci-"

  echo
  echo "→ Bootstrap CI registry PAT ($GITEA_URL, user $GITEA_USER)"
  read -r -s -p "  password: " GP; echo
  read -r -p "  2FA OTP (Enter se não tens 2FA): " OTP

  AUTH=(-u "$GITEA_USER:$GP")
  [ -n "$OTP" ] && AUTH+=(-H "X-Gitea-OTP: $OTP")

  # 1. Revogar PATs antigos com prefix kamal-ci-* (rotação limpa)
  EXISTING=$(curl -fsS "${AUTH[@]}" "$GITEA_URL/api/v1/users/$GITEA_USER/tokens?page=1&limit=50" \
    | jq -r --arg p "$TOKEN_PREFIX" '.[]|select(.name|startswith($p))|.name')
  if [ -n "$EXISTING" ]; then
    echo "$EXISTING" | while read -r t; do
      [ -z "$t" ] && continue
      HTTP=$(curl -fsS -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" \
        "$GITEA_URL/api/v1/users/$GITEA_USER/tokens/$t" || true)
      [ "$HTTP" = "204" ] && echo "  ✓ revogado: $t" || echo "  ✗ falhou ($HTTP): $t"
    done
  fi

  # 2. Criar PAT novo (scope write:package = push para registry OCI)
  TNAME="${TOKEN_PREFIX}$(date +%Y%m%d-%H%M)"
  CI_PAT=$(curl -fsS "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$TNAME\",\"scopes\":[\"write:package\"]}" \
    "$GITEA_URL/api/v1/users/$GITEA_USER/tokens" | jq -r '.sha1')

  if [ -z "$CI_PAT" ] || [ "$CI_PAT" = "null" ]; then
    echo "✗ falhou a criar PAT $TNAME" >&2
    exit 1
  fi
  echo "  ✓ PAT criado: $TNAME"

  # 3. Publica como Actions secret (PUT é idempotent)
  HTTP=$(curl -sS -o /tmp/.gitea-secret-resp -w '%{http_code}' -X PUT "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"data\":\"$CI_PAT\"}" \
    "$GITEA_URL/api/v1/repos/$REPO/actions/secrets/KAMAL_REGISTRY_PASSWORD")

  case "$HTTP" in
    201|204) echo "  ✓ Actions secret KAMAL_REGISTRY_PASSWORD published ($REPO)" ;;
    *) echo "✗ publish failed HTTP $HTTP: $(cat /tmp/.gitea-secret-resp)" >&2; exit 1 ;;
  esac
  rm -f /tmp/.gitea-secret-resp
fi
