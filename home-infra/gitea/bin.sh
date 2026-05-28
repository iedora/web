#!/usr/bin/env bash
# Idempotent. Zero flags. Remote: `DOCKER_HOST=ssh://root@<host> ./bin.sh`.
# `.env` (committed) tem config hardcoded; `bws run` injecta secrets.
set -euo pipefail
: "${BWS_ACCESS_TOKEN:?must be set}"
cd "$(dirname "${BASH_SOURCE[0]}")"

if docker network inspect homelab-core >/dev/null 2>&1; then
  echo "  → network homelab-core (já)"
else
  docker network create homelab-core >/dev/null
  echo "  → network homelab-core ✓"
fi

bws run -- docker compose up -d
