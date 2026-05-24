package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/eduvhc/iedora/infra/internal/bws"
	"github.com/eduvhc/iedora/infra/internal/cloudflare"
	"github.com/eduvhc/iedora/infra/internal/r2"
)

// runIacApply is Stage 2 of the pipeline. Brings up shared infrastructure
// via Tofu on `infra/tofu/` — VPS, Cloudflare (DNS, R2, GitHub config),
// Docker network + volumes, every shared service container (postgres,
// openobserve, zitadel, zitadel-login, caddy, backups).
//
// Idempotent. Designed to run on every deploy; a warm run is a fast
// no-diff refresh. Does NOT touch any product container (menu_web is owned
// by Stage 4) and does NOT configure Zitadel app state (owned by Stage 3).
//
// Flags:
//
//	--skip-init   skip the leading `tofu init` (CI runs it as a separate step)
func runIacApply(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("iac apply", flag.ContinueOnError)
	fs.SetOutput(stderr)
	skipInit := fs.Bool("skip-init", false, "skip leading tofu init")
	if err := fs.Parse(argv); err != nil {
		return err
	}

	if !*skipInit {
		fmt.Fprintln(stderr, "→ tofu init")
		if err := initIfNeeded(ctx, true); err != nil {
			return fmt.Errorf("tofu init: %w", err)
		}
	}

	parallel := "-parallelism=20"

	// ── Pass 1: Hetzner box (UNCONDITIONAL) ─────────────────────────────
	// Targeted apply so the docker provider (which reaches the box via
	// SSH) can resolve a hetzner_ipv4 before its first plan. Always run,
	// even on warm deploys — it's a fast refresh when the box exists.
	fmt.Fprintln(stderr, "→ Pass 1/2: targeted Hetzner apply (gates docker provider)")
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

	// SSH host-key rotation. Two sources to scrub: the fresh IP (so the
	// next SSH from the docker provider doesn't trip on a stale key from
	// a prior instance) and the PRIOR IP from BWS IAC_BOOTSTRAP_HOST_IP.
	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws project id: %w", err)
	}
	allSecrets, err := bws.ListSecrets(ctx, projectID)
	if err != nil {
		return fmt.Errorf("bws secrets: %w", err)
	}
	_, priorIP, _ := bws.Find(allSecrets, "IAC_BOOTSTRAP_HOST_IP")
	rotateKnownHosts(ctx, priorIP, hetznerIPv4)

	// ── Pass 2: full apply ──────────────────────────────────────────────
	// No zitadel provider → no placeholder dance, no HTTPS_PROXY, no
	// waitForMenuDNS. menu_web is gone from this root too (Stage 4 owns
	// it). Single clean apply.
	fmt.Fprintln(stderr, "→ Pass 2/2: full tofu apply")
	if err := runTofu(ctx, nil, "apply", "-auto-approve", parallel); err != nil {
		return fmt.Errorf("apply: %w", err)
	}

	fmt.Fprintln(stderr, "→ Write-through IAC_BOOTSTRAP_HOST_IP to BWS")
	if err := bws.Upsert(ctx, projectID, "IAC_BOOTSTRAP_HOST_IP", hetznerIPv4); err != nil {
		return fmt.Errorf("bws upsert IAC_BOOTSTRAP_HOST_IP: %w", err)
	}

	fmt.Fprintln(stderr, "✓ iac apply complete")
	return nil
}

// runIacDestroy is Stage 2's teardown. Step order:
//
//  1. state-rm docker_* + docker readiness barrier — those resources live
//     on the VPS which is about to die. Tearing them down individually
//     wastes SSH round-trips AND the kreuzwerker docker_network provider
//     has a hardcoded 30s wait_for_state on network removal.
//  2. Empty R2 buckets that are still in state (CF API would 409 + burn
//     30s × buckets on non-empty bucket DELETE).
//  3. tofu destroy.
//  4. Scrub instance-bound BWS keys + ~/.ssh/known_hosts.
//
// Does NOT state-rm zitadel_* — they're not in state anymore (extracted
// to Stage 3). Does NOT state-rm menu_web docker_* — also extracted
// (Stage 4).
func runIacDestroy(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("iac destroy", flag.ContinueOnError)
	fs.SetOutput(stderr)
	if err := fs.Parse(argv); err != nil {
		return err
	}

	fmt.Fprintln(stderr, "→ tofu init")
	if err := initIfNeeded(ctx, false); err != nil {
		return fmt.Errorf("tofu init: %w", err)
	}

	priorIP, _ := runTofuOutput(ctx, nil, "output", "-raw", "hetzner_ipv4")

	// ── Step 1: state-rm VPS-coupled resources ──────────────────────────
	resources, err := runTofuList(ctx, nil)
	if err != nil {
		return fmt.Errorf("state list: %w", err)
	}
	var toRemove []string
	for _, r := range resources {
		if strings.HasPrefix(r, "docker_") {
			toRemove = append(toRemove, r)
			continue
		}
		switch r {
		case "null_resource.docker_ready", "null_resource.docker_ready[0]":
			toRemove = append(toRemove, r)
		}
	}
	if len(toRemove) > 0 {
		fmt.Fprintf(stderr, "→ Step 1/4: state-rm %d VPS-coupled resources\n", len(toRemove))
		for _, addr := range toRemove {
			if err := runTofu(ctx, nil, "state", "rm", addr); err != nil {
				fmt.Fprintf(stderr, "  ! state rm %q failed (continuing): %v\n", addr, err)
			}
		}
	} else {
		fmt.Fprintln(stderr, "→ Step 1/4: no VPS-coupled resources to state-rm")
	}

	// ── Step 2: empty R2 buckets ────────────────────────────────────────
	fmt.Fprintln(stderr, "→ Step 2/4: empty R2 buckets")
	if err := emptyR2BucketsInState(ctx); err != nil {
		fmt.Fprintf(stderr, "  ! R2 empty failed (continuing — destroy may 409): %v\n", err)
	}

	// ── Step 3: tofu destroy ────────────────────────────────────────────
	fmt.Fprintln(stderr, "→ Step 3/4: tofu destroy")
	if err := runTofu(ctx, nil, "destroy", "-auto-approve",
		"-var", "allow_masterkey_rotation=true",
	); err != nil {
		return fmt.Errorf("destroy: %w", err)
	}

	// ── Step 4: scrub BWS + known_hosts ─────────────────────────────────
	fmt.Fprintln(stderr, "→ Step 4/4: scrub instance-bound BWS secrets + known_hosts")
	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws project id: %w", err)
	}
	// Drop the instance-bound infra keys + every Zitadel-side output the
	// reconciler wrote in Stage 3 (they're tied to the now-dead Zitadel).
	scrub := []string{
		"IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON",
		"IAC_BOOTSTRAP_HOST_IP",
		"APP_ZITADEL_MENU_OIDC_CLIENT_ID",
		"APP_ZITADEL_MENU_OIDC_CLIENT_SECRET",
		"APP_ZITADEL_MENU_SA_TOKEN",
		"APP_ZITADEL_PERMISSIONS_SIGNING_KEY",
		"APP_ZITADEL_GRANTS_SIGNING_KEY",
		"APP_ZITADEL_IEDORA_PROJECT_ID",
	}
	for _, key := range scrub {
		if err := bws.Delete(ctx, projectID, key); err != nil {
			fmt.Fprintf(stderr, "  ! bws delete %s failed (continuing): %v\n", key, err)
			continue
		}
		fmt.Fprintf(stderr, "  - %s scrubbed\n", key)
	}

	if priorIP != "" {
		rotateKnownHosts(ctx, priorIP)
		fmt.Fprintf(stderr, "  - known_hosts entry for %s removed\n", priorIP)
	}

	fmt.Fprintln(stderr, "✓ iac destroy complete")
	return nil
}

// ── R2 helpers (port from old destroy.go) ────────────────────────────────────

func emptyR2BucketsInState(ctx context.Context) error {
	buckets, err := bucketsFromState(ctx)
	if err != nil {
		return fmt.Errorf("list R2 buckets in state: %w", err)
	}
	if len(buckets) == 0 {
		fmt.Fprintln(stderr, "  - no R2 buckets in state, nothing to empty")
		return nil
	}

	cfToken := os.Getenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN")
	if cfToken == "" {
		return fmt.Errorf("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN missing (bin/with-secrets should inject it)")
	}
	accountID := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	if accountID == "" {
		return fmt.Errorf("CLOUDFLARE_ACCOUNT_ID missing (bin/with-secrets should inject it)")
	}

	accessKey, secretKey, err := cloudflare.R2S3Credentials(ctx, cfToken)
	if err != nil {
		return fmt.Errorf("derive R2 S3 credentials: %w", err)
	}
	client, err := r2.New(accountID, accessKey, secretKey)
	if err != nil {
		return err
	}

	var wg sync.WaitGroup
	errs := make(chan error, len(buckets))
	for _, b := range buckets {
		wg.Add(1)
		go func(bucket string) {
			defer wg.Done()
			fmt.Fprintf(stderr, "  - emptying %s …\n", bucket)
			if err := client.EmptyBucket(ctx, bucket); err != nil {
				errs <- fmt.Errorf("empty %s: %w", bucket, err)
				return
			}
			fmt.Fprintf(stderr, "  - %s emptied\n", bucket)
		}(b)
	}
	wg.Wait()
	close(errs)

	var combined []error
	for e := range errs {
		combined = append(combined, e)
	}
	if len(combined) > 0 {
		return errors.Join(combined...)
	}
	return nil
}

func bucketsFromState(ctx context.Context) ([]string, error) {
	resources, err := runTofuList(ctx, nil)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, r := range resources {
		if !strings.HasPrefix(r, "cloudflare_r2_bucket.") {
			continue
		}
		out, err := runTofuOutput(ctx, nil, "state", "show", r)
		if err != nil {
			return nil, fmt.Errorf("state show %s: %w", r, err)
		}
		for line := range strings.SplitSeq(out, "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "name") {
				continue
			}
			if idx := strings.Index(line, "="); idx > 0 {
				val := strings.TrimSpace(line[idx+1:])
				val = strings.Trim(val, `"`)
				if val != "" {
					names = append(names, val)
					break
				}
			}
		}
	}
	return names, nil
}

// _ keeps the time import alive while we hold off on adding deploy budget
// flags in the iac stage (a future --tofu-timeout flag will land here).
var _ = time.Second
