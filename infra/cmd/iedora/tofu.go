package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// tofuCmd builds a `tofu -chdir=tofu` command with optional extra args. stdin
// is connected to /dev/null; stdout/stderr stream straight through to the
// operator's terminal so they see real-time progress (especially valuable
// for the multi-minute initial apply on a fresh Hetzner box).
//
// All callers run inside infra/, the same working directory the justfile
// uses. We bind that explicitly via cmd.Dir so the binary works regardless
// of where the operator invoked it from (eg from the repo root via `just
// infra::deploy`, which actually `cd`s under the hood).
func tofuCmd(ctx context.Context, extraEnv []string, args ...string) *exec.Cmd {
	full := append([]string{"-chdir=tofu"}, args...)
	cmd := exec.CommandContext(ctx, "tofu", full...)
	cmd.Dir = infraDir()
	cmd.Env = append(os.Environ(), extraEnv...)
	return cmd
}

// runTofu streams output to the user's terminal. Use for apply/destroy/init.
func runTofu(ctx context.Context, extraEnv []string, args ...string) error {
	cmd := tofuCmd(ctx, extraEnv, args...)
	cmd.Stdout = os.Stderr // tofu writes most of its prose to stdout; we want it interleaved with logs but on stderr so a future plumbed-into-pipe caller can still capture clean output
	cmd.Stderr = os.Stderr
	cmd.Stdin = nil
	return cmd.Run()
}

// runTofuOutput captures stdout. Use for `tofu output -raw <name>` etc. Empty
// stdout is returned as ("", nil) — the caller decides if that's an error.
// (Reminder: `tofu output -raw <missing>` exits 0 with a Warning on stderr
// instead of failing — pitfall #1 in the brief. We always test for empty
// stdout, never the exit code.)
func runTofuOutput(ctx context.Context, extraEnv []string, args ...string) (string, error) {
	cmd := tofuCmd(ctx, extraEnv, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Surface tofu's stderr — usually the most useful diagnostic.
		return "", fmt.Errorf("tofu %s: %w (stderr: %s)", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// runTofuList runs `tofu state list` and returns the lines, filtered to non-
// empty. Empty state returns ([]string{}, nil).
func runTofuList(ctx context.Context, extraEnv []string) ([]string, error) {
	out, err := runTofuOutput(ctx, extraEnv, "state", "list")
	if err != nil {
		// `tofu state list` exits 0 even on no state, but on a hard error
		// (bad passphrase, unreadable backend) it does fail — pass through.
		return nil, err
	}
	if out == "" {
		return nil, nil
	}
	lines := strings.Split(out, "\n")
	clean := make([]string, 0, len(lines))
	for _, l := range lines {
		if s := strings.TrimSpace(l); s != "" {
			clean = append(clean, s)
		}
	}
	return clean, nil
}

// initIfNeeded runs `tofu init -input=false`. The upgrade flag is opt-in
// since plain init is cheaper and we don't always want to bump providers
// inside an automated apply run.
func initIfNeeded(ctx context.Context, upgrade bool) error {
	args := []string{"init", "-input=false"}
	if upgrade {
		args = append(args, "-upgrade")
	}
	// Init has chatty stdout we don't want polluting the operator's view;
	// only show stderr (errors + warnings).
	cmd := tofuCmd(ctx, nil, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
