# Auto-generated container secrets — Tofu mints them on first apply,
# stores them in encrypted state, and syncs them to BWS for human
# lookup (think: psql into the live DB, log in to Zitadel UI).
#
# Why AUTOGEN_ prefix in BWS: the operator's keychain shows two groups
# at a glance — `INFRA_*` (must populate before first deploy) and
# `IAC_*` (Tofu writes these; don't touch). Less cognitive
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
  # window documented in docs/deploy.md, not via plain replace.
}

resource "random_password" "zitadel_masterkey" {
  length  = 32 # Zitadel rejects anything other than exactly 32 chars
  special = false
  # See docs/deploy.md "Do NOT rotate casually" — rotating this
  # makes the encrypted projection table unreadable. The gate inverts
  # the explicit `allow_masterkey_rotation` knob: false (default) →
  # prevent_destroy = true, blocking any -replace. To actually rotate,
  # pass `TF_VAR_allow_masterkey_rotation=true` for that single apply.
  # Dynamic prevent_destroy is OpenTofu 1.12+ — it lets us gate this
  # behind a variable instead of code-editing the lifecycle block.
  lifecycle {
    prevent_destroy = !var.allow_masterkey_rotation
  }
}

resource "random_password" "zitadel_first_admin" {
  length  = 24
  special = true
  # Only used on FirstInstance. Real admin password is changed via
  # the Zitadel UI on first login. Operator looks this up in BWS
  # under IAC_ZITADEL_FIRST_ADMIN_PASSWORD.
}

resource "random_password" "openobserve_password" {
  length  = 32
  special = false # carries through to HTTP Basic-auth, keep ASCII safe
}

# NOTE: menu's session JWE key (DEPLOY_MENU_SESSION_SECRET) is NOT
# minted here. It's an app secret — consumed only by the menu container,
# never by an IaC-managed resource — so Stage 4 (`iedora deploy menu`)
# mints + upserts it to BWS via the productRuntime's appSecrets mechanism
# (`infra/cmd/iedora/runtime_docker.go`). Tofu's secrets.tf is reserved
# for secrets that govern how IaC containers boot (postgres password,
# backup passphrase, Zitadel masterkey, etc.).

# Sync each generated value to BWS under its IAC_* key.
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
    IAC_POSTGRES_PASSWORD              = random_password.postgres.result
    IAC_BACKUP_PASSPHRASE              = random_password.backup_passphrase.result
    IAC_ZITADEL_MASTERKEY              = random_password.zitadel_masterkey.result
    IAC_ZITADEL_FIRST_ADMIN_PASSWORD   = random_password.zitadel_first_admin.result
    IAC_OPENOBSERVE_ROOT_USER_PASSWORD = random_password.openobserve_password.result
  }
}

resource "terraform_data" "bws_sync_autogen" {
  for_each = toset(keys(local.autogen_lookup))

  triggers_replace = sha256(local.autogen_lookup[each.key])

  # Single Go helper at infra/bin/bws-upsert handles list-then-edit-or-
  # create, including the leading-`-` value quoting bws CLI's clap parser
  # is strict about. Same shape as null_resource.iedora_admin_grants ↔
  # bin/zitadel-grant. Replaces a duplicate bash+jq heredoc that drifted
  # against internal/bws.Upsert.
  provisioner "local-exec" {
    environment = {
      BWS_KEY        = each.key
      BWS_VALUE      = local.autogen_lookup[each.key]
      BWS_PROJECT_ID = var.bws_project_id
    }
    command = "${path.module}/../bin/bws-upsert"
  }
}
