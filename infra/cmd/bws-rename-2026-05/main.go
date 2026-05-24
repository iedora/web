// bws-rename-2026-05 — one-shot BWS key migration.
//
// Renames every legacy key to the new IAC_BOOTSTRAP_* / IAC_* / APP_* /
// DEPLOY_* taxonomy. Idempotent: re-runs no-op once every old key is
// either renamed or absent.
//
// Usage:
//
//	bin/with-secrets --stage iac -- go run ./cmd/bws-rename-2026-05
//
// Behavior per old key:
//   - old absent, new absent     → skip
//   - old present, new absent    → upsert new with old's value, delete old
//   - old present, new present   → if values match, just delete old;
//                                  if they differ, BAIL with diagnostic
//                                  (operator picks which value wins)
//   - old absent, new present    → skip (already migrated)
//
// Delete after one successful run on prod.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

// renames is the canonical mapping. Order is irrelevant — each row is
// processed independently.
var renames = []struct{ old, new string }{
	// Bootstrap (operator-provided) → IAC_BOOTSTRAP_*
	{"INFRA_HCLOUD_TOKEN", "IAC_BOOTSTRAP_HCLOUD_TOKEN"},
	{"INFRA_CLOUDFLARE_API_TOKEN", "IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN"},
	{"INFRA_GITHUB_API_TOKEN", "IAC_BOOTSTRAP_GITHUB_API_TOKEN"},
	{"INFRA_STATE_PASSPHRASE", "IAC_BOOTSTRAP_STATE_PASSPHRASE"},
	{"INFRA_GHCR_TOKEN", "IAC_BOOTSTRAP_GHCR_TOKEN"},
	{"INFRA_SSH_PRIVATE_KEY", "IAC_BOOTSTRAP_SSH_PRIVATE_KEY"},
	{"INFRA_ZITADEL_SA_KEY_JSON", "IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON"},
	{"INFRA_CLAUDE_CODE_OAUTH_TOKEN", "IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN"},
	{"INFRA_HOST_IP", "IAC_BOOTSTRAP_HOST_IP"},
	{"INFRA_OPENOBSERVE_ROOT_USER_EMAIL", "IAC_BOOTSTRAP_OPENOBSERVE_ROOT_USER_EMAIL"},

	// Tofu-minted (Stage 2) → IAC_*
	{"AUTOGEN_INFRA_POSTGRES_PASSWORD", "IAC_POSTGRES_PASSWORD"},
	{"AUTOGEN_INFRA_BACKUP_PASSPHRASE", "IAC_BACKUP_PASSPHRASE"},
	{"AUTOGEN_INFRA_ZITADEL_MASTERKEY", "IAC_ZITADEL_MASTERKEY"},
	{"AUTOGEN_INFRA_ZITADEL_FIRST_ADMIN_PASSWORD", "IAC_ZITADEL_FIRST_ADMIN_PASSWORD"},
	{"AUTOGEN_INFRA_OPENOBSERVE_ROOT_USER_PASSWORD", "IAC_OPENOBSERVE_ROOT_USER_PASSWORD"},

	// Stage 3 outputs → APP_*
	{"INFRA_ZITADEL_MENU_OIDC_CLIENT_ID", "APP_ZITADEL_MENU_OIDC_CLIENT_ID"},
	{"INFRA_ZITADEL_MENU_OIDC_CLIENT_SECRET", "APP_ZITADEL_MENU_OIDC_CLIENT_SECRET"},
	{"INFRA_ZITADEL_MENU_SA_TOKEN", "APP_ZITADEL_MENU_SA_TOKEN"},
	{"INFRA_ZITADEL_PERMISSIONS_SIGNING_KEY", "APP_ZITADEL_PERMISSIONS_SIGNING_KEY"},
	{"INFRA_ZITADEL_GRANTS_SIGNING_KEY", "APP_ZITADEL_GRANTS_SIGNING_KEY"},
	{"INFRA_ZITADEL_IEDORA_PROJECT_ID", "APP_ZITADEL_IEDORA_PROJECT_ID"},

	// Stage 4 mint → DEPLOY_*
	{"AUTOGEN_INFRA_MENU_SESSION_SECRET", "DEPLOY_MENU_SESSION_SECRET"},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "bws-rename-2026-05: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	ctx := context.Background()

	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		return err
	}

	secrets, err := bws.ListSecrets(ctx, projectID)
	if err != nil {
		return err
	}
	index := make(map[string]bws.Secret, len(secrets))
	for _, s := range secrets {
		index[s.Key] = s
	}

	var skipped, migrated, alreadyDone int
	for _, r := range renames {
		oldS, oldOK := index[r.old]
		newS, newOK := index[r.new]

		switch {
		case !oldOK && !newOK:
			fmt.Printf("  skip   %-46s  (neither old nor new present)\n", r.old)
			skipped++
		case !oldOK && newOK:
			fmt.Printf("  done   %-46s  →  %s  (already migrated)\n", r.old, r.new)
			alreadyDone++
		case oldOK && newOK && oldS.Value == newS.Value:
			fmt.Printf("  prune  %-46s  →  %s  (values match, dropping old)\n", r.old, r.new)
			if err := bws.Delete(ctx, projectID, r.old); err != nil {
				return fmt.Errorf("delete %s: %w", r.old, err)
			}
			migrated++
		case oldOK && newOK && oldS.Value != newS.Value:
			return fmt.Errorf(
				"both %s and %s exist with different values — resolve manually before re-running",
				r.old, r.new,
			)
		case oldOK && !newOK:
			fmt.Printf("  rename %-46s  →  %s\n", r.old, r.new)
			if err := bws.Upsert(ctx, projectID, r.new, oldS.Value); err != nil {
				return fmt.Errorf("upsert %s: %w", r.new, err)
			}
			if err := bws.Delete(ctx, projectID, r.old); err != nil {
				return fmt.Errorf("delete %s (new key %s already written): %w", r.old, r.new, err)
			}
			migrated++
		}
	}

	fmt.Printf("\nrenamed %d / already-done %d / skipped %d\n", migrated, alreadyDone, skipped)
	return nil
}
