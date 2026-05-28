#!/usr/bin/env bash
# Bootstrap git access ao Gitea num Mac novo (Setup 2 — HTTPS-only).
# Idempotente.
#
# O que faz:
#   - Pede credenciais Gitea (uma vez)
#   - Cria PAT via API, guarda no macOS keychain
#   - Configura git remote `gitea` para HTTPS
#   - Configura credential helper (osxkeychain)
#
# O que NÃO faz (intencional):
#   - Não configura SSH key (a operator key `~/.ssh/iedora-homelab-*`
#     existe só para `ssh root@homelab` / kamal — não toca git)
#   - Não configura commit signing (opcional, fica para outro flow)
#   - Não toca em Bitwarden Desktop / SSH Agent
#
# PATs são descartáveis: se perderes o keychain, corres este script
# outra vez. Não há nada para fazer backup.

set -euo pipefail

GITEA=${GITEA_URL:-https://git.iedora.com}
GITEA_USER_DEFAULT=eduvhc

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }

require() { command -v "$1" >/dev/null || { red "✗ falta: $1"; exit 1; }; }
require curl
require git
require python3

# ── 1. Gitea credentials ───────────────────────────────────────────────
bold "→ Credenciais Gitea ($GITEA)"
read -r -p "Username [$GITEA_USER_DEFAULT]: " GUSER
GUSER=${GUSER:-$GITEA_USER_DEFAULT}
read -r -s -p "Password: " GPASS; echo
read -r -p "2FA OTP (Enter se não tens 2FA): " GOTP

GAUTH=(-u "$GUSER:$GPASS")
[ -n "$GOTP" ] && GAUTH+=(-H "X-Gitea-OTP: $GOTP")

# ── 2. Pre-flight: PATs antigos deste host ─────────────────────────────
HOST_SHORT=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
TOKEN_PREFIX="iedora-mac-$HOST_SHORT-"

bold "→ A verificar PATs existentes para '$HOST_SHORT'..."
EXISTING=$(curl -fsS "${GAUTH[@]}" "$GITEA/api/v1/users/$GUSER/tokens?page=1&limit=50" 2>/dev/null \
  | python3 -c "
import sys, json
prefix = '$TOKEN_PREFIX'
try:
    toks = [t['name'] for t in json.load(sys.stdin) if t['name'].startswith(prefix)]
    print('\n'.join(toks))
except Exception:
    pass
")

if [ -n "$EXISTING" ]; then
  echo "$EXISTING" | while read -r t; do echo "  • $t"; done
  read -r -p "Revogar estes PATs antes de criar novo? [Y/n] " yn
  if [[ ! "$yn" =~ ^[Nn]$ ]]; then
    echo "$EXISTING" | while read -r t; do
      [ -z "$t" ] && continue
      HTTP=$(curl -fsS -o /dev/null -w '%{http_code}' -X DELETE "${GAUTH[@]}" \
        "$GITEA/api/v1/users/$GUSER/tokens/$t" || true)
      if [ "$HTTP" = "204" ]; then
        green "  ✓ revogado: $t"
      else
        red "  ✗ falhou ($HTTP): $t"
      fi
    done
  fi
else
  green "✓ nenhum PAT antigo deste host"
fi

# ── 3. Cria PAT ────────────────────────────────────────────────────────
TOKEN_NAME="${TOKEN_PREFIX}$(date +%Y%m%d-%H%M)"
bold "→ A criar PAT '$TOKEN_NAME'..."

PAT_HTTP=$(curl -fsS -o /tmp/.gitea-pat-resp -w '%{http_code}' "${GAUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$TOKEN_NAME\",\"scopes\":[\"write:repository\"]}" \
  "$GITEA/api/v1/users/$GUSER/tokens" || true)

if [ "$PAT_HTTP" = "422" ] && grep -q "name has been used" /tmp/.gitea-pat-resp 2>/dev/null; then
  red "✗ PAT '$TOKEN_NAME' já existe. Espera 60s e re-corre,"
  red "  ou revoga em $GITEA/user/settings/applications."
  exit 1
elif [ "$PAT_HTTP" != "201" ]; then
  red "✗ falhou a criar PAT (HTTP $PAT_HTTP): $(cat /tmp/.gitea-pat-resp)"
  exit 1
fi

PAT=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["sha1"])' < /tmp/.gitea-pat-resp)
green "✓ PAT criado (também visível em $GITEA/user/settings/applications)"

# ── 4. Guarda PAT no macOS keychain ────────────────────────────────────
bold "→ A guardar PAT no macOS keychain..."
printf 'protocol=https\nhost=git.iedora.com\nusername=%s\npassword=%s\n\n' \
  "$GUSER" "$PAT" | git credential-osxkeychain store
green "✓ keychain populado"

# ── 5. Git global config ───────────────────────────────────────────────
bold "→ A configurar git credential helper..."
git config --global credential.helper osxkeychain
green "✓ credential.helper = osxkeychain"

# ── 6. Repo remote para HTTPS ──────────────────────────────────────────
if [ -d ".git" ] && git remote get-url gitea >/dev/null 2>&1; then
  bold "→ A garantir que o remote 'gitea' aponta a HTTPS..."
  git remote set-url gitea "$GITEA/$GUSER/$(basename "$PWD").git"
  green "✓ remote gitea = $(git remote get-url gitea)"
fi

# ── 7. Smoke test ──────────────────────────────────────────────────────
# Só git ls-remote — endpoints `/api/v1/user*` exigem scope read:user
# que não pedimos (só write:repository), e o que importa é git push/pull
# funcionar, não a API.
echo
bold "→ Smoke test"
if [ -d ".git" ] && git remote get-url gitea | grep -q "^https://"; then
  if git ls-remote gitea HEAD >/dev/null 2>&1; then
    green "✓ git ls-remote gitea funciona (PAT serve via keychain)"
  else
    red "✗ git ls-remote gitea falhou — verifica keychain"
  fi
else
  green "✓ (smoke test skip — não estás num clone com remote 'gitea')"
fi

echo
green "═══════════════════════════════════════════════════════════"
green "  ✓ Setup completo. Próxima push é silenciosa (keychain serve)."
green "═══════════════════════════════════════════════════════════"

rm -f /tmp/.gitea-pat-resp
