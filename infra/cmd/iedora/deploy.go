package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// runDeploy is the Go port of the `just infra::deploy` bash recipe. The
// pipeline is intentionally the same Pass 1 / Pass 2 / Pass 3 dance as
// before; the brief was clear that the shape is right, only the
// fragility around DNS + cert lag + SSH host-key churn needs hardening.
//
// Flags:
//
//	--skip-init        skip the leading `tofu init` (CI prefers this when
//	                   it has already run init manually in a prior step,
//	                   to keep the upload-artifact step's runtime predictable).
//	--ready-budget DUR cap how long we wait for /debug/ready + LE cert.
//	                   Default 6m — covers cold-Hetzner-boot worst case
//	                   on a CPX22 (~90s to land Docker + ~60s for first
//	                   Zitadel migrations + ~30s for ACME challenge).
//
// All flags are optional. Defaults match production CI; the operator
// usually just runs `bin/iedora deploy` with no args.
func runDeploy(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("deploy", flag.ContinueOnError)
	skipInit := fs.Bool("skip-init", false, "skip leading tofu init")
	readyBudget := fs.Duration("ready-budget", 6*time.Minute, "max wait for Zitadel /debug/ready + LE cert")
	if err := fs.Parse(argv); err != nil {
		return err
	}

	if !*skipInit {
		fmt.Fprintln(stderr, "→ tofu init")
		if err := initIfNeeded(ctx, true); err != nil {
			return fmt.Errorf("tofu init: %w", err)
		}
	}

	// ── Pass 1: Hetzner box (UNCONDITIONAL) ─────────────────────────────
	// Always run the targeted hcloud + docker-readiness apply. Why
	// always? The "skip if hetzner_ipv4 output present" gate the old
	// recipe used is unreliable across destroy/deploy cycles:
	//   - destroy completes; state file has no resources;
	//   - tofu output -raw hetzner_ipv4 sometimes still returns the
	//     prior IP from a cached eval (witnessed in round-3 log,
	//     2026-05-21);
	//   - that makes the deploy skip Pass 1 and head into Pass 2 where
	//     the docker provider hits "ssh: Host key verification failed"
	//     against an IP that was just recycled to someone else.
	// Pass 1 is idempotent: if the box already exists with no diff,
	// it's a ~3s refresh. The redundancy is well worth eliminating
	// the brittle gate. (We also no longer need any "is the state
	// post-destroy?" reasoning — every deploy runs the same path.)
	fmt.Fprintln(stderr, "→ Pass 1/3: targeted Hetzner apply (always — gates docker provider)")
	if err := runTofu(ctx, nil, "apply", "-auto-approve",
		"-target=hcloud_ssh_key.operator",
		"-target=hcloud_firewall.iedora",
		"-target=hcloud_server.iedora",
		"-target=null_resource.docker_ready",
	); err != nil {
		return fmt.Errorf("pass 1 apply: %w", err)
	}
	hetznerIPv4, err := runTofuOutput(ctx, nil, "output", "-raw", "hetzner_ipv4")
	if err != nil || hetznerIPv4 == "" {
		return fmt.Errorf("post-pass-1 hetzner_ipv4 still empty (err=%v)", err)
	}

	// SSH host key rotation. Two sources to scrub:
	//   - the current IP (it just got a fresh sshd, so even on a "no-op"
	//     Pass 1 the host keys are unchanged but rotating is a no-op).
	//   - the PRIOR IP from BWS INFRA_HOST_IP. After a destroy + deploy
	//     where Hetzner recycles a different IP, ssh-keygen -R on the
	//     prior IP keeps ~/.ssh/known_hosts tidy. (No-op if the IPs match.)
	projectID, err := bwsProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws project id: %w", err)
	}
	allSecrets, err := bwsListSecrets(ctx, projectID)
	if err != nil {
		return fmt.Errorf("bws secrets: %w", err)
	}
	_, priorIP, _ := bwsFindSecret(allSecrets, "INFRA_HOST_IP")
	rotateKnownHosts(ctx, priorIP, hetznerIPv4)

	// ── Pass 2: depends on cold vs warm ──────────────────────────────────
	// Cold deploy (no SA key in BWS):
	//   - run Pass 2 in PLACEHOLDER MODE so the zitadel TF provider's
	//     Configure() succeeds with a fake access_token + every
	//     zitadel_* resource gates count=0/enabled=false. Containers
	//     land, FirstInstance runs, key gets minted.
	//   - then wait for /debug/ready + LE cert.
	//   - then fetch the SA key into BWS.
	//   - then Pass 3 with the real key, via the DNS-override proxy.
	//
	// Warm deploy (SA key already in BWS):
	//   - SKIP the placeholder split entirely. Running Pass 2 with empty
	//     SA key when zitadel_* are already in state forces a refresh
	//     under the placeholder token, which Zitadel rejects with
	//     "Errors.Token.Invalid" (caught 2026-05-21 in bulk-test
	//     round 4). The two passes collapse into one apply with the
	//     real SA key. Zitadel is already up — no readiness wait
	//     needed — and the DNS-override proxy still guards the
	//     OIDC discovery from the operator's NXDOMAIN cache.
	_, _, saKeyPresent := bwsFindSecret(allSecrets, "INFRA_ZITADEL_SA_KEY_JSON")

	// Always-on DNS-override proxy. Cheap (single-port http.Server),
	// harmless on warm deploys where DNS resolves fine, REQUIRED on
	// warm deploys where the operator's resolver still has the
	// NXDOMAIN cached from the prior destroy/deploy round.
	overrides := map[string]string{
		"auth.iedora.com:443": hetznerIPv4 + ":443",
		"auth.iedora.com:80":  hetznerIPv4 + ":80",
	}
	proxy := newDNSOverrideProxy(overrides)
	proxyURL, err := proxy.Start(ctx)
	if err != nil {
		return fmt.Errorf("start dns-override proxy: %w", err)
	}
	defer proxy.Stop()

	extraEnv := []string{
		"HTTPS_PROXY=" + proxyURL,
		"HTTP_PROXY=" + proxyURL,
		"NO_PROXY=" + strings.Join([]string{
			"localhost", "127.0.0.1", "::1",
			hetznerIPv4, // docker SSH dial uses the bare IP — direct
		}, ","),
	}

	if !saKeyPresent {
		// Cold deploy — bootstrap dance.
		fmt.Fprintln(stderr, "→ Pass 2/3: apply (placeholder Zitadel mode, bootstrap)")
		if err := runTofu(ctx, nil, "apply", "-auto-approve",
			"-var", "infra_zitadel_sa_key_json=",
		); err != nil {
			return fmt.Errorf("pass 2 apply: %w", err)
		}

		fmt.Fprintf(stderr, "→ Waiting for https://%s/debug/ready + LE cert (budget %s)\n", "auth.iedora.com", *readyBudget)
		elapsed, err := waitForZitadelReady(ctx, readinessTarget{Hostname: "auth.iedora.com", IPv4: hetznerIPv4}, *readyBudget)
		if err != nil {
			return fmt.Errorf("zitadel readiness: %w (check `just infra::logs zitadel`)", err)
		}
		fmt.Fprintf(stderr, "  ✓ ready after %s\n", elapsed.Round(time.Second))

		fmt.Fprintln(stderr, "→ Pass 3/3: fetching FirstInstance SA key → BWS")
		if err := fetchAndStoreSAKey(ctx, hetznerIPv4, projectID); err != nil {
			return fmt.Errorf("fetch SA key: %w", err)
		}
		// Set TF_VAR inline — bin/iedora's BWS hydration ran before we
		// started, so the env doesn't have the freshly-fetched key.
		newSecrets, err := bwsListSecrets(ctx, projectID)
		if err != nil {
			return fmt.Errorf("re-read BWS after SA key fetch: %w", err)
		}
		if _, val, ok := bwsFindSecret(newSecrets, "INFRA_ZITADEL_SA_KEY_JSON"); ok {
			os.Setenv("TF_VAR_infra_zitadel_sa_key_json", val)
		} else {
			return fmt.Errorf("SA key still missing in BWS after fetch — check zitadel-bootstrap volume")
		}

		fmt.Fprintf(stderr, "→ Pass 3/3: apply (real Zitadel SA, via %s)\n", proxyURL)
		if err := runTofu(ctx, extraEnv, "apply", "-auto-approve"); err != nil {
			return fmt.Errorf("pass 3 apply: %w", err)
		}
	} else {
		// Warm deploy — single apply with the real SA key.
		fmt.Fprintf(stderr, "→ Pass 2/2: apply (real Zitadel SA, via %s)\n", proxyURL)
		if err := runTofu(ctx, extraEnv, "apply", "-auto-approve"); err != nil {
			return fmt.Errorf("apply: %w", err)
		}
	}

	// Write-through INFRA_HOST_IP to BWS. The destroy recipe scrubs it,
	// so steady-state INFRA_HOST_IP in BWS is always the IP of the
	// currently-deployed box.
	fmt.Fprintln(stderr, "→ Write-through INFRA_HOST_IP to BWS")
	if err := bwsUpsert(ctx, projectID, "INFRA_HOST_IP", hetznerIPv4); err != nil {
		return fmt.Errorf("bws upsert INFRA_HOST_IP: %w", err)
	}

	fmt.Fprintln(stderr, "✓ deploy complete")
	return nil
}

// fetchAndStoreSAKey runs the SSH + docker dance that was previously
// the `just zitadel-fetch-sa-key` recipe. Inlined here because it's
// only called once per Zitadel lifetime and inlining keeps the
// orchestrator self-contained.
func fetchAndStoreSAKey(ctx context.Context, host, projectID string) error {
	// Wait for the FirstInstance step to actually land the key on the
	// bootstrap volume. The /debug/ready=200 above is a STRONG signal
	// that FirstInstance ran, but volumes are written from a different
	// goroutine — give it 60s of grace.
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		err := sshExec(ctx, host, "docker run --rm -v zitadel-bootstrap:/x busybox test -s /x/zitadel-admin-sa.json")
		if err == nil {
			break
		}
		sleep(ctx, 5*time.Second)
	}

	key, err := sshCapture(ctx, host, "docker run --rm -v zitadel-bootstrap:/x busybox cat /x/zitadel-admin-sa.json")
	if err != nil {
		return fmt.Errorf("read SA key from bootstrap volume: %w", err)
	}
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("SA key file present but empty")
	}
	if err := bwsUpsert(ctx, projectID, "INFRA_ZITADEL_SA_KEY_JSON", key); err != nil {
		return fmt.Errorf("bws upsert INFRA_ZITADEL_SA_KEY_JSON: %w", err)
	}
	return nil
}
