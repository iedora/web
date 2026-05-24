package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/eduvhc/iedora/infra/internal/bws"
	"github.com/eduvhc/iedora/infra/internal/tlsprobe"
)

// ensureSAKey is the binary's self-bootstrap. It runs BEFORE reconcile
// and is responsible for everything `zitadel-apply` needs to authenticate
// to its target service:
//
//  1. Verify Zitadel is healthy (TLS probe — `/debug/ready` returning 200
//     with a real LE cert, not Caddy's internal CA).
//  2. Locate the SA key. Order of preference:
//       a. IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON in env (warm path: with-secrets
//          injected it from BWS).
//       b. BWS (in case we're running outside with-secrets — e.g. dev
//          orchestrator).
//       c. SSH to the box and `docker run` against the
//          `zitadel-bootstrap` named volume (cold path: FirstInstance
//          just minted the key; nothing has read it yet).
//  3. Persist the result to BWS so subsequent runs hit step (a).
//
// Skipped entirely when `--no-bws` is set: dev mode passes the key via
// env and the orchestrator handles the probe + fetch.
//
// Stage 3 orchestrator independence: this function is the contract that
// makes `bin/zitadel-apply` self-sufficient. `cmd/iedora/app.go` knows
// nothing about Zitadel — it just iterates configurators.
func ensureSAKey(ctx context.Context, cfg Config, noBWS bool) (string, error) {
	if k := os.Getenv("IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON"); k != "" {
		return k, nil
	}
	if noBWS {
		return "", fmt.Errorf("--no-bws mode requires IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON in env (dev orchestrator should set it)")
	}

	// Warm-path BWS read. with-secrets normally injects this into env
	// at the parent layer, but we also check directly in case the
	// binary is invoked outside `bin/with-secrets`.
	pid, err := bws.ProjectID(ctx)
	if err != nil {
		return "", fmt.Errorf("resolve BWS project: %w", err)
	}
	secrets, err := bws.ListSecrets(ctx, pid)
	if err != nil {
		return "", fmt.Errorf("bws list: %w", err)
	}
	if _, val, ok := bws.Find(secrets, "IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON"); ok {
		return val, nil
	}

	// Cold path. Need the box IP to SSH for the SA key.
	host := os.Getenv("IAC_BOOTSTRAP_HOST_IP")
	if host == "" {
		return "", fmt.Errorf("IAC_BOOTSTRAP_HOST_IP missing — `task infra:up` writes it to BWS; check Stage 2 completed")
	}

	// Health gate: Zitadel must be up + serving the real LE cert before
	// we try to talk to it. tlsprobe rejects Caddy's internal CA (the
	// 200-but-wrong-cert window during ACME-TLS-ALPN-01).
	zitadelHost := hostnameOf(cfg.BaseURL)
	if zitadelHost == "" {
		zitadelHost = "auth.iedora.com"
	}
	fmt.Fprintf(stderr, "→ Waiting for https://%s/debug/ready + LE cert (budget %s)\n", zitadelHost, cfg.MenuDNSBudget)
	if _, err := tlsprobe.Wait(ctx, tlsprobe.Target{Hostname: zitadelHost, IPv4: host}, 6*time.Minute); err != nil {
		return "", fmt.Errorf("zitadel readiness: %w (check `ssh root@%s docker logs infra-zitadel`)", err, host)
	}
	fmt.Fprintln(stderr, "  ✓ ready")

	fmt.Fprintln(stderr, "→ Fetching FirstInstance SA key from zitadel-bootstrap volume")
	key, err := fetchSAKeyFromBox(ctx, host)
	if err != nil {
		return "", fmt.Errorf("fetch SA key: %w", err)
	}

	// Persist so warm runs hit the env / BWS path.
	if err := bws.Upsert(ctx, pid, "IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON", key); err != nil {
		return "", fmt.Errorf("bws upsert IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON: %w", err)
	}
	return key, nil
}

// fetchSAKeyFromBox SSHes to the Hetzner box and reads the
// FirstInstance-minted JSON key out of the `zitadel-bootstrap` named
// volume via a one-shot `docker run` against busybox. The named volume
// is shared between the zitadel container (which writes it on first
// boot) and any container that mounts it.
//
// Waits up to 60s for the file to appear with non-zero size — the
// readiness probe gates on `/debug/ready` but FirstInstance writes the
// volume from a different goroutine, so there's a small write-after-
// signal window.
func fetchSAKeyFromBox(ctx context.Context, host string) (string, error) {
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if err := sshExec(ctx, host, "docker run --rm -v zitadel-bootstrap:/x busybox test -s /x/zitadel-admin-sa.json"); err == nil {
			break
		}
		select {
		case <-time.After(5 * time.Second):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	out, err := sshCaptureStdout(ctx, host, "docker run --rm -v zitadel-bootstrap:/x busybox cat /x/zitadel-admin-sa.json")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("SA key file present but empty")
	}
	return out, nil
}

// sshExec runs an SSH command, streaming to stderr. Same shape as the
// helper in `wait_dns.go` — kept separate so this file is self-contained.
func sshExec(ctx context.Context, host, remoteCmd string) error {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"root@"+host, remoteCmd)
	cmd.Stdout = stderr
	cmd.Stderr = stderr
	return cmd.Run()
}

// sshCaptureStdout runs an SSH command and returns stdout. Used to read
// the SA key file content — must NOT stream to stderr (that's where logs
// go, and the file content can be huge JSON).
func sshCaptureStdout(ctx context.Context, host, remoteCmd string) (string, error) {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"root@"+host, remoteCmd)
	cmd.Stderr = stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("ssh root@%s %q: %w", host, remoteCmd, err)
	}
	return string(out), nil
}
