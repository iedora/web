# GitHub repo configuration — Actions secrets + variables, declared.
#
# Replaces the imperative `gh secret set` × N + `gh variable set` × N
# instructions that used to live in docs/deploy.md. The repo's CI/CD
# inputs are now defined in this file; `just infra::deploy` reconciles
# them alongside Cloudflare + Tailscale.
#
# Drift behaviour (mirror of the Tailscale ACL): Tofu OVERWRITES any
# value that doesn't match what's declared here. Edit values in this
# file (or the BWS keys feeding the sensitive ones), not in the GitHub
# UI. The provider does NOT delete secrets/variables it doesn't manage,
# so legacy entries (e.g. the leftover BETTER_AUTH_SECRET from earlier
# flows) persist outside Tofu's view until you `gh secret delete` them.
#
# Branch protection: deliberately absent. See docs/deploy.md /
# memory `project_branch_protection.md` — solo, AI-driven, CI is the
# signal. Revisit when adding collaborators.

# Non-secret variables. Same source-of-truth shape as variables.tf:
# values default to production strings; override via TF_VAR_* if needed
# (e.g. for a fork pointing at a different deployment).
locals {
  github_variables = {
    BWS_PROJECT_ID       = var.bws_project_id
    MENU_PUBLIC_HOSTNAME = var.menu_public_hostname
    # Pointer to which CF account owns the rest of the secrets. Local
    # `bin/with-secrets` auto-discovers this from the CF /accounts API
    # (only one account on the token). CI uses this GHA variable
    # directly instead of doing the API roundtrip per workflow run.
    CLOUDFLARE_ACCOUNT_ID = var.account_id
  }

  # Sensitive secrets. Sourced from BWS-fed Tofu vars at apply time;
  # the values flow into GH-encrypted-secrets and never persist in
  # plaintext beyond the apply.
  github_secrets = {
    BWS_ACCESS_TOKEN        = var.bws_access_token
    IAC_BOOTSTRAP_SSH_PRIVATE_KEY   = var.infra_ssh_private_key
    CLAUDE_CODE_OAUTH_TOKEN = var.claude_code_oauth_token
  }
}

resource "github_actions_variable" "vars" {
  for_each      = local.github_variables
  repository    = var.github_repo
  variable_name = each.key
  value         = each.value
}

resource "github_actions_secret" "secrets" {
  for_each    = local.github_secrets
  repository  = var.github_repo
  secret_name = each.key
  # `value` is the v6.12+ argument name; `plaintext_value` is deprecated.
  # Both flow through GitHub-encrypted-secrets identically.
  value = each.value
}
