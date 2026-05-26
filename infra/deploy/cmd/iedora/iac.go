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

	"github.com/eduvhc/iedora/internal/bws"
	"github.com/eduvhc/iedora/internal/cloudflare"
	"github.com/eduvhc/iedora/internal/mode"
	"github.com/eduvhc/iedora/internal/r2"
)

// runIacApply is Stage 2 of the pipeline. Brings up shared infrastructure
// via Tofu on `infra/iac/tofu/` — VPS, Cloudflare (DNS, R2, GitHub config),
// Docker network + volumes, every shared service container (postgres,
// openobserve, zitadel, zitadel-login, caddy, backups).
//
// Idempotent. Designed to run on every deploy; a warm run is a fast
// no-diff refresh. Does NOT touch any product container (menu_web is owned
// by Stage 4) and does NOT configure Zitadel app state (owned by Stage 3).
func runIacApply(ctx context.Context, argv []string) error {
	currentMode.Require(mode.Live)

	fs := flag.NewFlagSet("iac apply", flag.ContinueOnError)
	fs.SetOutput(stderr)
	if err := fs.Parse(argv); err != nil {
		return err
	}

	// Explicit init with -upgrade. Subsequent tofu calls in this process
	// will see sync.Once already triggered and skip re-init; this is the
	// only path that honours the upgrade flag, hence the explicit call
	// instead of relying on the lazy path that always runs without
	// upgrade.
	fmt.Fprintln(stderr, "→ tofu init -upgrade")
	if err := initIfNeeded(ctx, true); err != nil {
		return fmt.Errorf("tofu init: %w", err)
	}

	// Two parallelism budgets:
	//
	//   apiParallel    Cloud-API resources (cloudflare_*, github_actions_*,
	//                  terraform_data.bws_sync_autogen[*], docker_network/volume
	//                  primitives). Three separate vendors, each with its own
	//                  rate limit — fanning out wide is safe and saves wall
	//                  time (a GitHub Actions secret create is ~5 minutes
	//                  end-to-end; without parallelism they serialize).
	//
	//   sshParallel    docker_container resources whose provider talks to the
	//                  Hetzner box over SSH. sshd's default MaxStartups is
	//                  10:30:100 (10 unauthenticated connections, then random-
	//                  drops above 30, rejects above 100), so anything above
	//                  ~5 trips "Connection reset by peer" on cold deploys
	//                  when many container creates hit the auth phase
	//                  concurrently. Five keeps us well under MaxStartups.
	const (
		apiParallel = "-parallelism=20"
		sshParallel = "-parallelism=5"
	)

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

	// ── Pass 2a: cloud-API + docker primitives (high parallelism) ──────
	// Cloudflare (R2 buckets, DNS, R2 custom domains), GitHub Actions
	// (secrets, variables), and the BWS write-through provisioners (each
	// a separate POST against bitwarden) all hit different vendor APIs.
	// Each has its own rate limit; fanning out at 20 saves real wall time
	// because GH Actions secrets and R2 custom_domains are 5+ minutes
	// each end-to-end. docker_network + docker_volume creates also belong
	// here — they're per-resource SSH ops but quick (sub-second once the
	// connection is up); piling them with docker_container creates
	// wastes the SSH budget on cheap work.
	fmt.Fprintln(stderr, "→ Pass 2a/2b: cloud APIs + docker primitives (parallelism=20)")
	if err := runTofu(ctx, nil, "apply", "-auto-approve", apiParallel,
		"-target=cloudflare_r2_bucket.data",
		"-target=cloudflare_r2_bucket.assets",
		"-target=cloudflare_r2_bucket_cors.assets",
		"-target=cloudflare_r2_custom_domain.assets",
		"-target=cloudflare_dns_record.menu_iedora",
		"-target=cloudflare_dns_record.auth_iedora",
		"-target=cloudflare_dns_record.obs_iedora",
		"-target=cloudflare_api_token.tofu_state",
		"-target=cloudflare_api_token.menu_assets",
		"-target=github_actions_secret.secrets",
		"-target=github_actions_variable.vars",
		"-target=terraform_data.bws_sync_autogen",
		"-target=docker_network.iedora",
		"-target=docker_volume.caddy_data",
		"-target=docker_volume.zitadel_bootstrap",
		"-target=docker_container.zitadel_bootstrap_chmod",
	); err != nil {
		return fmt.Errorf("pass 2a apply: %w", err)
	}

	// ── Pass 2b: docker_container resources (low parallelism) ──────────
	// Each docker_container.* SSHes to the box. parallelism=5 keeps us
	// safely under sshd's MaxStartups 10:30:100. Pass 2b is an
	// untargeted apply — Tofu picks up everything Pass 2a left
	// unfinished (mostly docker_container.{postgres,zitadel,openobserve,
	// caddy,backups}, the zitadel-login sidecar, and any output-only
	// settle). Targets aren't required because the graph is now
	// effectively just docker_container; running it untargeted also
	// surfaces drift in resources we didn't list above.
	fmt.Fprintln(stderr, "→ Pass 2b/2b: docker containers over SSH (parallelism=5)")
	if err := runTofu(ctx, nil, "apply", "-auto-approve", sshParallel); err != nil {
		return fmt.Errorf("pass 2b apply: %w", err)
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
	currentMode.Require(mode.Live)

	fs := flag.NewFlagSet("iac destroy", flag.ContinueOnError)
	fs.SetOutput(stderr)
	if err := fs.Parse(argv); err != nil {
		return err
	}

	// First runTofu* call below will lazily `tofu init -input=false` via
	// sync.Once — no explicit init needed (destroy doesn't want -upgrade).
	priorIP, _ := runTofuOutput(ctx, nil, "output", "-raw", "hetzner_ipv4")

	// ── Step 1: state-rm VPS-coupled resources ──────────────────────────
	resources, err := runTofuList(ctx, nil)
	if err != nil {
		return fmt.Errorf("state list: %w", err)
	}
	var toRemove []string
	for _, r := range resources {
		// Top-level (docker_*) and module-nested (module.*.docker_*) are
		// equally VPS-coupled — the kreuzwerker provider has to talk to
		// the Docker daemon over SSH, and the daemon is about to die
		// with the box. Matching on `.docker_` catches the module form
		// (module.postgres.docker_container.this, etc.) without false
		// positives — no resource we own uses `_docker_` as a suffix.
		if strings.HasPrefix(r, "docker_") || strings.Contains(r, ".docker_") {
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
