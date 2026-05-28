#!/usr/bin/env bash
# Hadolint wrapper. Lança hadolint com JSON output, faz pipe para o
# parser TS (parse-hadolint.ts) que converte para workflow annotations
# (Gitea renderiza inline no PR).
#
# Threshold: warnings anotam mas exit=0; só level=error quebra CI.
# Equivalente a --failure-threshold=error, mas o threshold vive no
# parser para uniformizar lógica.
#
# Uso: run-hadolint.sh <Dockerfile> [Dockerfile2 ...]

set -eu  # NÃO -o pipefail: hadolint exit 1 com findings (qualquer nível)
         # e queremos deixar o parser TS decidir o exit final.

if [ $# -lt 1 ]; then
  echo "usage: $0 <Dockerfile> [...]" >&2
  exit 2
fi

# bun (presente no oven/bun:1.3-debian image) parsa o JSON e emite
# annotations. Versus python3 (que NÃO está no image) ou jq (ditto).
HERE="$(dirname "$(readlink -f "$0")")"
/opt/audit-bin/hadolint --no-color --format json "$@" | bun "$HERE/parse-hadolint.ts"
