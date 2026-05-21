package main

import (
	"context"
	"fmt"
	"os/exec"
)

// runDoctor checks deploy-readiness on the operator's machine. Cheap
// preflight that fails fast if a recipe would have crashed half-way
// through. Designed to be safe to run any time — no mutation.
func runDoctor(ctx context.Context, _ []string) error {
	fmt.Fprintln(stderr, "→ Checking required binaries on PATH")
	required := []string{"tofu", "bws", "ssh", "ssh-keygen", "ssh-keyscan"}
	missing := []string{}
	for _, bin := range required {
		path, err := exec.LookPath(bin)
		if err != nil {
			fmt.Fprintf(stderr, "  ✗ %s — NOT FOUND\n", bin)
			missing = append(missing, bin)
			continue
		}
		fmt.Fprintf(stderr, "  ✓ %s → %s\n", bin, path)
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing binaries: %v", missing)
	}

	fmt.Fprintln(stderr, "→ Checking BWS access")
	projectID, err := bwsProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws access: %w", err)
	}
	fmt.Fprintf(stderr, "  ✓ BWS project: %s\n", projectID)

	secrets, err := bwsListSecrets(ctx, projectID)
	if err != nil {
		return fmt.Errorf("bws list secrets: %w", err)
	}
	fmt.Fprintf(stderr, "  ✓ %d secrets visible\n", len(secrets))

	fmt.Fprintln(stderr, "→ Checking required bootstrap secrets")
	bootstrap := []string{
		"INFRA_HCLOUD_TOKEN",
		"INFRA_CLOUDFLARE_API_TOKEN",
		"INFRA_STATE_PASSPHRASE",
		"INFRA_GITHUB_API_TOKEN",
		"INFRA_SSH_PRIVATE_KEY",
		"INFRA_GHCR_TOKEN",
		"INFRA_OPENOBSERVE_ROOT_USER_EMAIL",
	}
	for _, key := range bootstrap {
		if _, _, ok := bwsFindSecret(secrets, key); !ok {
			fmt.Fprintf(stderr, "  ✗ %s — MISSING (deploy will fail)\n", key)
			return fmt.Errorf("missing bootstrap secret: %s", key)
		}
		fmt.Fprintf(stderr, "  ✓ %s\n", key)
	}

	fmt.Fprintln(stderr, "✓ doctor checks passed — `iedora deploy` should run cleanly")
	return nil
}
