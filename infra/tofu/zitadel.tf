# Declarative management of the Zitadel IdP (issue #19, Phase 1.5+).
#
# This file is gated by `var.infra_zitadel_sa_key_json` being non-empty.
# Zitadel needs to be bootstrapped FIRST (FirstInstance runs on the
# auth.iedora.com box → mints the zitadel-admin-sa service account →
# writes its JSON key to the shared volume), and THEN the SA key has to
# reach BWS so `with-secrets` can hydrate this var. Until that happens,
# every zitadel_* resource has count=0, so the unconfigured provider is
# never actually called.
#
# Bootstrap sequence (one-shot, per Zitadel instance lifetime):
#   1. `just infra::deploy` → Hetzner up + containers up. FirstInstance
#      writes /zitadel-bootstrap/zitadel-admin-sa.json on the new box.
#   2. `just infra::zitadel-fetch-sa-key` → SSH + cat + upload to BWS.
#   3. `just infra::deploy` again → SA key flows through TF_VAR, count
#      flips to 1, org/project import + land declaratively from here on.
#
# After bootstrap there's no chicken-egg: ALL subsequent applies are
# single-shot. The dance happens exactly once per re-bootstrap, which is
# the same shape as the `INFRA_HCLOUD_TOKEN` one-time push.

provider "zitadel" {
  domain   = var.zitadel_hostname
  port     = "443"
  insecure = false
  # The provider runs `Configure()` at plan time regardless of whether any
  # resource uses it — it's NOT lazy. An empty `jwt_profile_json` makes
  # Configure() fail with "one authentication method must be configured",
  # blocking the entire plan during the bootstrap window. We sidestep that
  # by switching auth methods: during bootstrap we pass a static placeholder
  # `access_token` (any non-empty string satisfies the "one method" check);
  # once the real SA key reaches BWS we flip to `jwt_profile_json`. The
  # placeholder NEVER reaches Zitadel — every zitadel_* resource is gated
  # by `local.zitadel_bootstrapped` (count=0 during bootstrap).
  access_token     = local.zitadel_bootstrapped ? null : "placeholder-never-used"
  jwt_profile_json = local.zitadel_bootstrapped ? var.infra_zitadel_sa_key_json : null
}

locals {
  # All zitadel resources gate on this. Flipping `var.infra_zitadel_sa_key_json`
  # from empty → JSON makes them appear on the next plan as adds (org import +
  # project create). `nonsensitive()` is safe here: we're checking presence,
  # not the SA key's content. Without it, the sensitive bit on the var taints
  # every downstream `for_each`/`count` (TF refuses sensitive map keys).
  zitadel_bootstrapped = nonsensitive(var.infra_zitadel_sa_key_json) != ""
}

# Look up the existing iedora org (created by FirstInstance on first boot)
# by its well-known name so we can import it into state.
data "zitadel_orgs" "iedora" {
  count       = local.zitadel_bootstrapped ? 1 : 0
  name        = "iedora"
  name_method = "TEXT_QUERY_METHOD_EQUALS"
}

# Declarative import (OpenTofu 1.6+). Brings the FirstInstance-created
# `iedora` org under state management without running `tofu import`.
# Subsequent applies see no drift and the block is a no-op.
import {
  for_each = local.zitadel_bootstrapped ? toset(["iedora"]) : toset([])
  to       = zitadel_org.iedora[0]
  id       = tolist(data.zitadel_orgs.iedora[0].ids)[0]
}

# The iedora root org. Houses every project, OIDC app, action target, and
# (Phase 4) every member of every restaurant tenant. Name matches the
# FirstInstance env so the import lines up cleanly.
resource "zitadel_org" "iedora" {
  count      = local.zitadel_bootstrapped ? 1 : 0
  name       = "iedora"
  is_default = true
}

# The iedora project — parent for OIDC apps (menu, oauth2-proxy) coming
# in Phases 2-3. `project_role_assertion = true` makes Zitadel
# include the user's project roles in the access token, which menu's
# Better-Auth generic-oauth provider will consume directly (Phase 3).
resource "zitadel_project" "iedora" {
  count                  = local.zitadel_bootstrapped ? 1 : 0
  name                   = "iedora"
  org_id                 = zitadel_org.iedora[0].id
  project_role_assertion = true
}
