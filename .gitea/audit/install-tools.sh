#!/usr/bin/env bash
# Restore-or-install audit binaries (gitleaks + hadolint + osv-scanner).
#
# Idempotente: cada tool só descarrega se a versão actual no cache diferir
# da pinned. Cache persiste entre runs via bind-mount /var/cache/audit-tools
# → /opt/audit-bin no container (declarado no workflow caller, whitelistado
# em home-infra/gitea/runner-config.yaml valid_volumes).
#
# Re-runs típicos (cache hot) saltam os 3 curls + o apt install do curl.
# Cold start instala git + curl + binários: ~15-20s. Steady-state: ~1-2s.
#
# Variáveis pinned (override via env do composite action):
#   GITLEAKS_VERSION   default 8.30.1
#   HADOLINT_VERSION   default 2.14.0
#   OSV_VERSION        default 2.3.8
#
# Supply-chain mitigation pós-Trivy compromise (Março 2026): pin SHA-of-day
# em vez de tag, OU mantém versão revista trimestralmente.

set -euo pipefail

mkdir -p /opt/audit-bin

need() {
  local bin="$1" version_flag="$2" want="$3"
  [ ! -x "/opt/audit-bin/$bin" ] && return 0
  local have
  have=$("/opt/audit-bin/$bin" "$version_flag" 2>&1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)
  [ "$have" != "$want" ]
}

# oven/bun:1.3-debian é minimal: sem curl (download dos binários), sem git
# (gitleaks varre histórico). Cada job spawna container fresh — git é
# always-needed, curl só se algum tool fizer cache miss.
install_pkgs() {
  local pkgs=("$@")
  local missing=()
  for p in "${pkgs[@]}"; do
    command -v "$p" >/dev/null || missing+=("$p")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "→ apt install: ${missing[*]}"
    apt-get update -qq >/dev/null
    apt-get install -y --no-install-recommends -qq "${missing[@]}" ca-certificates >/dev/null
  fi
}

install_pkgs git

if need gitleaks version "$GITLEAKS_VERSION"; then
  install_pkgs curl
  echo "→ download gitleaks $GITLEAKS_VERSION"
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /opt/audit-bin gitleaks
fi

if need hadolint --version "$HADOLINT_VERSION"; then
  install_pkgs curl
  echo "→ download hadolint $HADOLINT_VERSION"
  curl -fsSL -o /opt/audit-bin/hadolint \
    "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-linux-x86_64"
  chmod +x /opt/audit-bin/hadolint
fi

if need osv-scanner --version "$OSV_VERSION"; then
  install_pkgs curl
  echo "→ download osv-scanner $OSV_VERSION"
  curl -fsSL -o /opt/audit-bin/osv-scanner \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64"
  chmod +x /opt/audit-bin/osv-scanner
fi

/opt/audit-bin/gitleaks version
/opt/audit-bin/hadolint --version
/opt/audit-bin/osv-scanner --version
