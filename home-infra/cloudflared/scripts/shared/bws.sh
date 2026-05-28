#!/usr/bin/env bash
# home-infra/scripts/shared/bws.sh — BWS helpers (idempotent, source-able).
#
# Contrato:
#   - Caller exporta BWS_ACCESS_TOKEN
#   - Project resolvido lazy (cache em BWS_PROJECT_ID; pode ser injectado)
#
# Funções expostas:
#   bws_project_id              echo id do project default (primeiro da lista)
#   bws_get <key>               echo valor do secret <key> (vazio se não existe)
#   bws_secret_upsert <k> <v>   create/edit no project default

bws_project_id() {
  if [ -n "${BWS_PROJECT_ID:-}" ]; then
    echo "$BWS_PROJECT_ID"
  else
    bws project list -o json | jq -r '.[0].id'
  fi
}

bws_get() {
  local key="$1" pid
  pid=$(bws_project_id)
  bws secret list "$pid" -o json | jq -r ".[]|select(.key==\"$key\")|.value" | head -1
}

bws_secret_upsert() {
  local key="$1" value="$2" pid existing_id current_val
  pid=$(bws_project_id)
  existing_id=$(bws secret list "$pid" -o json | jq -r ".[]|select(.key==\"$key\")|.id" | head -1)

  if [ -n "$existing_id" ]; then
    current_val=$(bws secret get "$existing_id" -o json | jq -r '.value')
    if [ "$current_val" = "$value" ]; then
      echo "BWS: $key já correcto (no-op)"
    else
      bws secret edit "$existing_id" --value "$value" >/dev/null
      echo "BWS: update $key"
    fi
  else
    bws secret create "$key" "$value" "$pid" >/dev/null
    echo "BWS: create $key"
  fi
}
