package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// runTofuOutput runs `tofu -chdir=tofu output -raw <name>` and returns
// the trimmed stdout. Stage 4 (deploy) uses this to read Stage-2-minted
// values (Hetzner IP, R2 creds, menu env) without keeping the full
// Tofu wrapper that used to live in `tofu.go`.
//
// Empty stdout returns ("", nil) — the caller decides if that's an
// error. (Pitfall: `tofu output -raw <missing>` exits 0 with a warning
// on stderr instead of failing.)
func runTofuOutput(ctx context.Context, _ []string, args ...string) (string, error) {
	full := append([]string{"-chdir=tofu"}, args...)
	cmd := exec.CommandContext(ctx, "tofu", full...)
	cmd.Dir = iacDir()
	cmd.Env = os.Environ()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tofu %s: %w (stderr: %s)", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}
