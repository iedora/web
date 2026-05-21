// Pre-staged mutation for bulk-test round 4. Append to
// infra/tofu/zitadel.tf BEFORE the "── Actions v2 ──" header, then run
// `bin/iedora deploy`. The expected diff is "1 to add, 0 to change, 0
// to destroy" — a single new zitadel_project_role landing without
// touching any other resource.
//
// Purpose: exercise the in-place change path (not just full bootstrap)
// against a live deployment, to confirm the DNS-override proxy + cert
// probe don't interfere with steady-state updates. Remove after
// verification.

resource "zitadel_project_role" "qr_codes_list" {
  org_id       = zitadel_org.iedora.id
  project_id   = zitadel_project.iedora.id
  role_key     = "qr-codes:list"
  display_name = "QR codes — list (round-4 test)"
  group        = "qr-codes"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}
