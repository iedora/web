// with-secrets — BWS env wrapper. Hydrates every BWS secret into env
// (+ TF_VAR_* aliases the Tofu config expects) and in-place execs the
// named command. Replaces a former bash script; every recipe, CI
// workflow, and docs example shells through this binary to get a
// Tofu-shaped env.
//
// Pipeline:
//
//  1. Verify BWS_ACCESS_TOKEN is set in the caller's env (no on-disk
//     `.env` file — keys-to-the-kingdom token lives only in shell-
//     sourced secrets file).
//  2. Discover the iedora-deploy project UUID (via `bws project list`,
//     or BWS_PROJECT_ID if already set).
//  3. List every secret in the project.
//  4. Discover CLOUDFLARE_ACCOUNT_ID via the CF /accounts API (skipped
//     when already pinned in env — CI uses a GH Actions variable).
//  5. Build the env slice: inherit caller's env + overlay BWS secrets
//     + add the TF_VAR_* aliases Tofu expects (see env.go for the
//     canonical mapping).
//  6. `syscall.Exec` the target command — in-place replacement, no
//     intermediate process. The child sees `BWS_ACCESS_TOKEN`,
//     `BWS_PROJECT_ID`, every `INFRA_*` secret, every `TF_VAR_*` alias.
//
// Inputs:
//
//	BWS_ACCESS_TOKEN   required, in shell env (e.g. `source ~/.secrets`).
//	BWS_PROJECT_ID     optional, auto-discovered if unset.
//	CLOUDFLARE_ACCOUNT_ID optional; auto-discovered if unset.
//
// How called:
//
//	bin/with-secrets <cmd>        direct (after cd infra).
//	just with-secrets <cmd>       root recipe — cds into infra/ first.
//	bin/iedora <subcmd>           layered: bin/iedora execs through
//	                              bin/with-secrets so the orchestrator
//	                              child sees a hydrated env.
//	tofu local-exec               CI / Tofu provisioners shell with-secrets
//	                              around inner tofu state ops.
//
// Failure modes (all loud — exit 1 + clear message on stderr):
//
//   - BWS_ACCESS_TOKEN missing.
//   - BWS project lookup or secret list fails (network / bad token).
//   - A required `INFRA_*` secret is missing in the BWS project.
//   - Target command not found on PATH.
//   - syscall.Exec itself fails (rare — kernel-level).
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: with-secrets <command> [args...]")
		os.Exit(1)
	}

	bwsAccessToken := os.Getenv("BWS_ACCESS_TOKEN")
	if bwsAccessToken == "" {
		fatal("BWS_ACCESS_TOKEN missing — export it in your shell (e.g. source ~/.secrets)")
	}

	ctx := context.Background()

	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		fatal("%v", err)
	}

	secrets, err := bws.ListSecrets(ctx, projectID)
	if err != nil {
		fatal("%v", err)
	}

	envSlice, err := buildEnvironment(ctx, secrets, bwsAccessToken, projectID, os.Environ())
	if err != nil {
		fatal("%v", err)
	}

	binaryPath, err := exec.LookPath(os.Args[1])
	if err != nil {
		fatal("command %q not found: %v", os.Args[1], err)
	}

	if err := syscall.Exec(binaryPath, os.Args[1:], envSlice); err != nil {
		fatal("exec failed: %v", err)
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "with-secrets: "+format+"\n", args...)
	os.Exit(1)
}
