// with-secrets — BWS env wrapper.
//
// Reads BWS_ACCESS_TOKEN from the operator's shell, discovers the
// iedora-deploy project, hydrates every BWS secret into env (+ TF_VAR_*
// aliases), then in-place execs the named command. Replaces a former
// bash script — every recipe / CI workflow / docs example shells
// `bin/with-secrets <cmd>` to get a Tofu-shaped env.
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
