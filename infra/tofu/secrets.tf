# Auto-generated container secrets — Tofu mints them on first apply,
# stores them in encrypted state, and syncs them to BWS for human
# lookup (think: psql into the live DB, log in to Zitadel UI).
#
# Why AUTOGEN_ prefix in BWS: the operator's keychain shows two groups
# at a glance — `INFRA_*` (must populate before first deploy) and
# `AUTOGEN_INFRA_*` (Tofu writes these; don't touch). Less cognitive
# load when bootstrapping a fresh environment.
#
# Rotation policy per secret — read the justfile `rotate-secret`
# recipe for the constraints. The big one: don't replace
# random_password.zitadel_masterkey casually — it encrypts every
# Zitadel internal secret, rotating it would brick the projection table.

resource "random_password" "postgres" {
  length  = 48
  special = false # special chars trip a few postgres-url parsers
}

resource "random_password" "backup_passphrase" {
  length  = 64
  special = false # GPG passphrase, keep ASCII alphanumeric
  # Replacing this orphans every previously-encrypted dump in R2.
  # Pre-launch: fine. Post-launch: handle via the dual-passphrase
  # window documented in docs/secrets.md, not via plain replace.
}

resource "random_password" "zitadel_masterkey" {
  length  = 32 # Zitadel rejects anything other than exactly 32 chars
  special = false
  # See docs/secrets.md "Do NOT rotate casually" — rotating this
  # makes the encrypted projection table unreadable. Lifecycle gate
  # so a stray -replace doesn't silently brick auth.
  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "zitadel_first_admin" {
  length  = 24
  special = true
  # Only used on FirstInstance. Real admin password is changed via
  # the Zitadel UI on first login. Operator looks this up in BWS
  # under AUTOGEN_INFRA_ZITADEL_FIRST_ADMIN_PASSWORD.
}

resource "random_password" "openobserve_password" {
  length  = 32
  special = false # carries through to HTTP Basic-auth, keep ASCII safe
}

# Sync each generated value to BWS under its AUTOGEN_INFRA_* key.
# Idempotent: if the secret exists, edit; else create. The bws CLI
# inherits BWS_ACCESS_TOKEN from the wrapping `bin/with-secrets` call.
#
# No Bitwarden-Secrets-Manager provider exists in the OpenTofu registry
# (checked 2026-05-20 — only `maxlaverse/bitwarden` for the password
# vault, no SM resource). `terraform_data` + local-exec is the
# documented escape hatch when no provider exists. `terraform_data`
# replaces the older `null_resource` pattern as of Tofu 1.4+ — same
# semantics, but `triggers_replace` is typed (any) and the resource is
# built into the terraform.io namespace, no extra provider needed.
#
# `triggers_replace` is set to a sha256 of the value so the diff in
# `tofu plan` shows "replaced because triggers_replace changed" without
# leaking the secret itself. Value is piped through an env var to keep
# it off the command line (avoids `ps` + shell-history disclosure).

locals {
  autogen_lookup = {
    AUTOGEN_INFRA_POSTGRES_PASSWORD              = random_password.postgres.result
    AUTOGEN_INFRA_BACKUP_PASSPHRASE              = random_password.backup_passphrase.result
    AUTOGEN_INFRA_ZITADEL_MASTERKEY              = random_password.zitadel_masterkey.result
    AUTOGEN_INFRA_ZITADEL_FIRST_ADMIN_PASSWORD   = random_password.zitadel_first_admin.result
    AUTOGEN_INFRA_OPENOBSERVE_ROOT_USER_PASSWORD = random_password.openobserve_password.result
  }
}

resource "terraform_data" "bws_sync_autogen" {
  for_each = toset(keys(local.autogen_lookup))

  triggers_replace = sha256(local.autogen_lookup[each.key])

  provisioner "local-exec" {
    environment = {
      BWS_KEY        = each.key
      BWS_VALUE      = local.autogen_lookup[each.key]
      BWS_PROJECT_ID = var.bws_project_id
    }
    interpreter = ["bash", "-c"]
    command     = <<-EOT
      set -euo pipefail
      SECRET_ID=$(bws secret list "$BWS_PROJECT_ID" -o json \
        | jq -r --arg k "$BWS_KEY" '.[] | select(.key==$k) | .id')
      if [ -n "$SECRET_ID" ]; then
        bws secret edit "$SECRET_ID" --value "$BWS_VALUE" -o none
      else
        bws secret create -o none -- "$BWS_KEY" "$BWS_VALUE" "$BWS_PROJECT_ID"
      fi
    EOT
  }
}
