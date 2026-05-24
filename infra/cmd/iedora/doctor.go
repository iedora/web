package main

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/eduvhc/iedora/infra/internal/bws"
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
	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws access: %w", err)
	}
	fmt.Fprintf(stderr, "  ✓ BWS project: %s\n", projectID)

	secrets, err := bws.ListSecrets(ctx, projectID)
	if err != nil {
		return fmt.Errorf("bws list secrets: %w", err)
	}
	fmt.Fprintf(stderr, "  ✓ %d secrets visible\n", len(secrets))

	fmt.Fprintln(stderr, "→ Checking required bootstrap secrets")
	bootstrap := []string{
		"IAC_BOOTSTRAP_HCLOUD_TOKEN",
		"IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN",
		"IAC_BOOTSTRAP_STATE_PASSPHRASE",
		"IAC_BOOTSTRAP_GITHUB_API_TOKEN",
		"IAC_BOOTSTRAP_SSH_PRIVATE_KEY",
		"IAC_BOOTSTRAP_GHCR_TOKEN",
		"IAC_BOOTSTRAP_OPENOBSERVE_ROOT_USER_EMAIL",
	}
	for _, key := range bootstrap {
		if _, _, ok := bws.Find(secrets, key); !ok {
			fmt.Fprintf(stderr, "  ✗ %s — MISSING (deploy will fail)\n", key)
			return fmt.Errorf("missing bootstrap secret: %s", key)
		}
		fmt.Fprintf(stderr, "  ✓ %s\n", key)
	}

	fmt.Fprintln(stderr, "✓ doctor checks passed — `iedora deploy` should run cleanly")
	return nil
}
