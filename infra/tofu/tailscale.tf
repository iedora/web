# Tailscale — tailnet ACL + the CI OAuth client used by GitHub Actions.
#
# Why here, not per-product: the tailnet is cross-product (the GHA runner
# uses the same tag:ci OAuth client to deploy every product). Shared infra
# is the right home; matches the shape of the shared Postgres + backups
# accessories.
#
# Bootstrap (one-time, UI): create an OAuth client in the Tailscale admin
# console with scopes `policy_file` + `oauth_keys` (the provider uses
# THAT client to manage the CI client + the ACL). Store its ID/secret in
# BWS as INFRA_TAILSCALE_OAUTH_CLIENT_{ID,SECRET}.
#
# Drift warning: `overwrite_existing_content = true` on tailscale_acl means
# Tofu will SILENTLY clobber any UI edits to the policy. Edit the ACL HERE,
# not in the admin console, after this resource is applied.

resource "tailscale_acl" "policy" {
  acl = jsonencode({
    tagOwners = {
      "tag:ci" = ["autogroup:owner"]
    }
    # Solo tailnet — default-allow. Tighten later (e.g. restrict tag:ci to
    # iedora-homelab:22 only) if the tailnet grows beyond one human +
    # ephemeral CI nodes.
    acls = [
      {
        action = "accept"
        src    = ["*"]
        dst    = ["*:*"]
      }
    ]
  })

  # Required on first apply to converge with the default policy Tailscale
  # ships every new tailnet. After that, every subsequent apply is a
  # write-through of this file's contents.
  overwrite_existing_content = true

  # Keep the policy in place on destroy — wiping the ACL to defaults could
  # lock CI out mid-flight. Manual reset is one UI click if ever needed.
  reset_acl_on_destroy = false
}

# The CI OAuth client the GitHub Actions runner uses to mint per-job
# ephemeral tailnet nodes. Scope is the narrowest possible: `auth_keys`
# only, with the issued keys constrained to tag:ci. A leak of THIS
# client's secret cannot escalate to ACL edits or device management.
resource "tailscale_oauth_client" "ci" {
  description = "iedora-gha-ci"
  scopes      = ["auth_keys"]
  tags        = ["tag:ci"]
}
