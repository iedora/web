#!/usr/bin/env bash
set -euo pipefail

# Reads outputs from infra/tofu/cloudflare/ (current workspace) and writes
# .envrc.<env> at the repo root. Source it (or use direnv) before running
# make targets / kamal commands for that env.
#
# Selecting which env:
#   CF_ENV=<name> bash scripts/cf-sync.sh        # explicit
#   bash scripts/cf-sync.sh                      # uses the active Tofu workspace
#
# The "default" workspace writes to .envrc (no suffix) — keeps the single-env
# case ergonomic.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF_DIR="${REPO_ROOT}/infra/tofu/cloudflare"

cd "${CF_DIR}"

# Resolve the env name: CF_ENV override > current workspace.
ENV_NAME="${CF_ENV:-$(tofu workspace show 2>/dev/null || echo default)}"

# Make sure we're on the right workspace before reading outputs.
if [ "${ENV_NAME}" != "$(tofu workspace show 2>/dev/null || echo default)" ]; then
  tofu workspace select "${ENV_NAME}"
fi

if ! tofu output -json >/dev/null 2>&1; then
  echo "Error: no Tofu state for workspace '${ENV_NAME}'. Run \`make cf-new-env\` first." >&2
  exit 1
fi

# Default workspace → .envrc; named workspaces → .envrc.<name>.
if [ "${ENV_NAME}" = "default" ]; then
  ENVRC="${REPO_ROOT}/.envrc"
else
  ENVRC="${REPO_ROOT}/.envrc.${ENV_NAME}"
fi

# Preserve any TF_VAR_* lines the user keeps in the file (token, passphrase,
# account ID, zone ID, etc). cf-sync only owns the Tofu-output exports below.
EXISTING_TF_VARS=""
if [ -f "${ENVRC}" ]; then
  EXISTING_TF_VARS="$(grep -E '^export TF_VAR_' "${ENVRC}" || true)"
fi

PUBLIC_HOSTNAME="$(tofu output -raw public_hostname)"
ASSETS_HOSTNAME="$(tofu output -raw assets_hostname)"
CLOUDFLARED_TUNNEL_TOKEN="$(tofu output -raw tunnel_token)"

umask 077
{
  echo "# Auto-managed by scripts/cf-sync.sh — re-run after a Cloudflare apply."
  echo "# Env: ${ENV_NAME}. Gitignored. Source manually or via direnv."
  echo
  if [ -n "${EXISTING_TF_VARS}" ]; then
    echo "# TF_VAR_* — preserved across syncs (you fill these once):"
    echo "${EXISTING_TF_VARS}"
    echo
  fi
  echo "# Cloudflare-managed (Tofu outputs):"
  echo "export PUBLIC_HOSTNAME='${PUBLIC_HOSTNAME}'"
  echo "export ASSETS_HOSTNAME='${ASSETS_HOSTNAME}'"
  echo "export CLOUDFLARED_TUNNEL_TOKEN='${CLOUDFLARED_TUNNEL_TOKEN}'"
  echo
  echo "# S3 endpoint = public assets hostname (routed via tunnel to MinIO :9000)."
  echo "# Cheaper to skip the tunnel for server-side ops but it requires code changes;"
  echo "# round-tripping via the CF edge adds ~30ms — fine for an admin app."
  echo "export S3_ENDPOINT=\"https://\${ASSETS_HOSTNAME}\""
  echo "export S3_REGION='us-east-1'   # MinIO accepts anything; this is conventional"
  echo "export S3_BUCKET='metamenu'    # set by the MinIO accessory bootstrap"
  echo
  echo "# Tofu workspace name (informational)"
  echo "export CF_ENV='${ENV_NAME}'"
} > "${ENVRC}"

echo "Wrote ${ENVRC} ($(wc -l < "${ENVRC}") lines, env=${ENV_NAME})"
