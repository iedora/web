package main

import (
	"context"
	"flag"
	"fmt"
	"strings"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

// runDestroy is the Go port of the `just infra::destroy` bash recipe.
// Three steps:
//
//  1. state-rm every zitadel_* resource + the local-exec null_resources
//     they depend on. Why: `tofu destroy` refreshes resources first, and
//     refreshing a zitadel_* hits the zitadel API — which is in the
//     process of being torn down. State-rm first; the live objects
//     vanish with the VPS anyway.
//  2. tofu destroy with placeholder Zitadel mode + masterkey-rotation
//     override.
//  3. Scrub instance-bound BWS keys + the prior IP from ~/.ssh/known_hosts.
func runDestroy(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("destroy", flag.ContinueOnError)
	if err := fs.Parse(argv); err != nil {
		return err
	}

	fmt.Fprintln(stderr, "→ tofu init")
	if err := initIfNeeded(ctx, false); err != nil {
		return fmt.Errorf("tofu init: %w", err)
	}

	// Grab the current IP BEFORE the destroy nukes the output — we
	// scrub its known_hosts entry as the last step.
	priorIP, _ := runTofuOutput(ctx, nil, "output", "-raw", "hetzner_ipv4")

	// ── Step 1: state-rm Zitadel + provisioners ─────────────────────────
	resources, err := runTofuList(ctx, nil)
	if err != nil {
		return fmt.Errorf("state list: %w", err)
	}

	var toRemove []string
	for _, r := range resources {
		if strings.HasPrefix(r, "zitadel_") || strings.HasPrefix(r, "data.zitadel_") {
			toRemove = append(toRemove, r)
			continue
		}
		switch r {
		case "null_resource.iedora_admin_grants",
			"null_resource.iedora_admin_grants[0]",
			"null_resource.menu_permissions_router_touch",
			"null_resource.menu_permissions_router_touch[0]":
			toRemove = append(toRemove, r)
		}
	}

	if len(toRemove) > 0 {
		fmt.Fprintf(stderr, "→ Step 1/3: state-rm %d Zitadel-coupled resources\n", len(toRemove))
		// Best-effort — a state-rm on an unknown address is non-fatal.
		// We don't want a partial state-rm to abort the destroy that
		// would clean up the rest.
		for _, addr := range toRemove {
			if err := runTofu(ctx, nil, "state", "rm", addr); err != nil {
				fmt.Fprintf(stderr, "  ! state rm %q failed (continuing): %v\n", addr, err)
			}
		}
	} else {
		fmt.Fprintln(stderr, "→ Step 1/3: no Zitadel resources in state to state-rm")
	}

	// ── Step 2: tofu destroy ────────────────────────────────────────────
	fmt.Fprintln(stderr, "→ Step 2/3: tofu destroy")
	if err := runTofu(ctx, nil, "destroy", "-auto-approve",
		"-var", "allow_masterkey_rotation=true",
		"-var", "infra_zitadel_sa_key_json=",
	); err != nil {
		return fmt.Errorf("destroy: %w", err)
	}

	// ── Step 3: scrub instance-bound BWS keys + known_hosts ─────────────
	fmt.Fprintln(stderr, "→ Step 3/3: scrub instance-bound BWS secrets + known_hosts")
	projectID, err := bws.ProjectID(ctx)
	if err != nil {
		return fmt.Errorf("bws project id: %w", err)
	}
	for _, key := range []string{"INFRA_ZITADEL_SA_KEY_JSON", "INFRA_HOST_IP"} {
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

	fmt.Fprintln(stderr, "✓ destroy complete")
	return nil
}
