#!/usr/bin/env bash
# Mac → Beelink one-shot deploy. Idempotent — re-correr safely.
#
#   1. valida pré-requisitos + pede CF token / DEEPSEEK se faltarem
#   2. tofu apply -auto-approve (no-op se nada mudou)
#   3. detecta cold (postgres não up) vs hot
#   4. kamal deploy (build cache hit → fast; push no-op se digest igual)
#   5. se cold → re-corre kamal deploy para aplicar migrations skipadas
#   6. smoke check https://iedora.com/up
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOFU_DIR="$SCRIPT_DIR/tofu"
KAMAL_CONFIG="infra/live/kamal/deploy.yml"
SOPS_FILE="$HOME/.config/iedora/secrets.sops.yaml"
AGE_KEY="$HOME/.config/sops/age/keys.txt"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ─── Cores ──────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
else
  BOLD=''; RED=''; GRN=''; YEL=''; RST=''
fi
step()   { printf '%s▶ %s%s\n' "$BOLD" "$1" "$RST"; }
ok()     { printf '%s✓ %s%s\n' "$GRN" "$1" "$RST"; }
warn()   { printf '%s! %s%s\n' "$YEL" "$1" "$RST"; }
die()    { printf '%s✗ %s%s\n' "$RED" "$1" "$RST" >&2; exit 1; }
prompt() {
  # prompt "Label" — read secret sem echo, devolve em REPLY.
  # Lê de /dev/tty (não de stdin) para funcionar dentro de pipes/loops.
  local label="$1"
  printf '%s? %s:%s ' "$YEL" "$label" "$RST" >&2
  read -rs REPLY </dev/tty
  echo >&2
  [[ -n "$REPLY" ]] || die "valor vazio"
}

# ─── 1. Binários + ficheiros ────────────────────────────────────────
step "Validar pré-requisitos"

for bin in kamal tofu sops gh docker base64 curl ssh openssl; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin não está instalado"
done

[[ -f "$AGE_KEY" ]] || die "age key em falta: $AGE_KEY (gera com: age-keygen -o $AGE_KEY)"
export SOPS_AGE_KEY_FILE="$AGE_KEY"
AGE_PUBKEY="$(grep -oE 'age1[a-z0-9]+' "$AGE_KEY" | head -1)"
[[ -n "$AGE_PUBKEY" ]] || die "não consegui extrair age pubkey de $AGE_KEY"

gh auth status >/dev/null 2>&1 || die "gh não autenticado — corre: gh auth login"

[[ -f "$TOFU_DIR/terraform.tfvars" ]] \
  || die "infra/live/tofu/terraform.tfvars em falta — copia de terraform.tfvars.example e mete o account_id"

# ─── 2. SOPS file (auto-create se não existir, prompt placeholders) ──
if [[ ! -f "$SOPS_FILE" ]]; then
  warn "SOPS file em falta — vou criá-lo agora"
  mkdir -p "$(dirname "$SOPS_FILE")"
  prompt "MOONSHOT_API_KEY"
  DEEPSEEK="$REPLY"
  TMP="$(mktemp)"
  cat >"$TMP" <<EOF
CORE_SECRET: $(openssl rand -base64 48 | tr -d '+/=')
POSTGRES_PASSWORD: $(openssl rand -base64 24 | tr -d '+/=')
OPENOBSERVE_ADMIN_PASSWORD: $(openssl rand -base64 24 | tr -d '+/=')
MOONSHOT_API_KEY: $DEEPSEEK
EOF
  SOPS_AGE_RECIPIENTS="$AGE_PUBKEY" sops encrypt "$TMP" > "$SOPS_FILE"
  chmod 600 "$SOPS_FILE"
  rm -f "$TMP"
  ok "SOPS file criado em $SOPS_FILE"
fi

# Substituir placeholders REPLACE_WITH_* se existirem
if sops decrypt "$SOPS_FILE" | grep -q "REPLACE_WITH_"; then
  warn "SOPS tem placeholders por preencher"
  PLAIN="$(sops decrypt "$SOPS_FILE")"
  TMP="$(mktemp)"
  while IFS= read -r line; do
    if [[ "$line" =~ ^([A-Z_]+):\ REPLACE_WITH_ ]]; then
      key="${BASH_REMATCH[1]}"
      prompt "$key"
      echo "$key: $REPLY" >>"$TMP"
    else
      echo "$line" >>"$TMP"
    fi
  done <<<"$PLAIN"
  SOPS_AGE_RECIPIENTS="$AGE_PUBKEY" sops encrypt "$TMP" > "$SOPS_FILE"
  chmod 600 "$SOPS_FILE"
  rm -f "$TMP"
  ok "placeholders preenchidos"
fi

# ─── 3. CLOUDFLARE_API_TOKEN (prompt se não exportado) ──────────────
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  warn "CLOUDFLARE_API_TOKEN não exportado"
  echo "  → cria um em https://dash.cloudflare.com/profile/api-tokens" >&2
  echo "  → scopes: Zone:Read + DNS:Edit + Cloudflare Tunnel:Edit + Account R2:Edit" >&2
  prompt "CLOUDFLARE_API_TOKEN"
  export CLOUDFLARE_API_TOKEN="$REPLY"
fi

ok "pré-requisitos OK"

# ─── 4. Tofu apply ──────────────────────────────────────────────────
step "Tofu apply (Cloudflare: tunnel + DNS + R2)"
(
  cd "$TOFU_DIR"
  [[ -d .terraform ]] || tofu init -input=false
  tofu apply -auto-approve -input=false
)
for f in .tunnel-token .s3-access-key .s3-secret-key; do
  [[ -s "$TOFU_DIR/$f" ]] || die "tofu não escreveu infra/live/tofu/$f"
done
ok "tunnel + DNS + R2 reconciliados"

# ─── 5. Detectar cold vs hot ────────────────────────────────────────
HOST="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$KAMAL_CONFIG" | head -1)"
[[ -n "$HOST" ]] || die "não consegui extrair host de $KAMAL_CONFIG"

SSH_KEY="$HOME/.ssh/ci_ed25519"
[[ -f "$SSH_KEY" ]] || die "SSH key em falta: $SSH_KEY"

COLD=0
if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       root@"$HOST" 'docker ps --format "{{.Names}}" | grep -qx iedora-web-postgres' 2>/dev/null; then
  ok "hot deploy (postgres up)"
else
  COLD=1
  warn "cold deploy detectado (postgres não up) — kamal deploy correrá 2x"
fi

# ─── 6. Kamal deploy ────────────────────────────────────────────────
step "Kamal deploy"
kamal -c "$KAMAL_CONFIG" deploy

if (( COLD )); then
  step "Cold deploy — re-correr para aplicar migrations"
  kamal -c "$KAMAL_CONFIG" deploy
fi

# ─── 7. Smoke check ─────────────────────────────────────────────────
step "Smoke check"
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 5 https://iedora.com/up >/dev/null 2>&1; then
    ok "https://iedora.com/up → 200"
    ok "deploy concluído"
    exit 0
  fi
  sleep 3
done
warn "smoke check falhou após 5 tentativas — verifica logs: ssh root@$HOST 'docker logs iedora-web'"
exit 1
