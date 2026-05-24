// zitadel-apply — Stage 3 (AppState) reconciler.
//
// Reconciles the Zitadel application state (org, project, roles, machine
// user + IAM grant + PAT, OIDC app, action targets + executions, admin
// grants) against the live Zitadel running on auth.iedora.com (prod) or
// localhost:8080 (dev). Idempotent.
//
// Auth: FirstInstance-minted SA key (JSON Web Profile, RS256). Reads from
// IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON in env.
//
// Output channels (pick one via flags):
//
//   default (no flag)              writes outputs to BWS (prod)
//   --no-bws --output-file PATH    writes outputs as JSON to PATH (dev)
//
// Inputs (env, set by `bin/with-secrets` for prod or the dev orchestrator):
//
//	IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON  full SA key JSON (the file FirstInstance writes)
//	ZA_BASE_URL                Zitadel base URL; defaults to https://auth.iedora.com
//	ZA_MENU_HOSTNAME           menu's public hostname; defaults to menu.iedora.com
//	ZA_ADMIN_EMAILS            JSON array OR comma-separated list of admin emails
//	ZA_SSH_HOST                Hetzner IPv4 for the menu-DNS gate; empty in dev
//	ZA_MENU_DNS_BUDGET         optional poll budget (e.g. "90s"); default 90s
//
// Flags:
//
//	--grants-only        skip full reconcile, only run admin email grants
//	--no-bws             skip BWS lookups + writes; use in-memory store
//	--output-file PATH   when --no-bws, serialise outputs as JSON to PATH
//	                     (also seeds the store from this path if it exists,
//	                     so warm dev runs keep stable PAT + signing keys)
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

func main() {
	stderr = os.Stderr
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "zitadel-apply: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, argv []string) error {
	fs := flag.NewFlagSet("zitadel-apply", flag.ContinueOnError)
	fs.SetOutput(io.Discard) // we own error formatting
	grantsOnly := fs.Bool("grants-only", false, "skip full reconcile; only run admin email grants")
	noBWS := fs.Bool("no-bws", false, "skip BWS lookups + writes; use in-memory store (dev mode)")
	outputFile := fs.String("output-file", "", "when --no-bws, serialise outputs as JSON to PATH")
	if err := fs.Parse(argv); err != nil {
		return err
	}

	cfg, err := loadConfig(*grantsOnly, *noBWS, *outputFile)
	if err != nil {
		return err
	}

	// Self-bootstrap: if the SA key isn't already in env, TLS-probe
	// Zitadel + fetch the FirstInstance key off the box. Keeps Stage 3's
	// orchestrator (cmd/iedora/app.go) dumb — it doesn't need to know
	// anything Zitadel-specific.
	if cfg.SAKeyJSON == "" {
		key, err := ensureSAKey(ctx, cfg, *noBWS)
		if err != nil {
			return err
		}
		cfg.SAKeyJSON = key
	}

	c, err := newClient(cfg.BaseURL, cfg.SAKeyJSON)
	if err != nil {
		return fmt.Errorf("new client: %w", err)
	}

	state, err := Reconcile(ctx, c, cfg)
	if err != nil {
		// Best-effort flush so a partial run still leaves what it did
		// produce on disk for the operator to inspect.
		_ = cfg.Store.Flush()
		return err
	}

	if err := cfg.Store.Flush(); err != nil {
		return fmt.Errorf("flush store: %w", err)
	}

	if !cfg.GrantsOnly {
		fmt.Fprintln(stderr, "✓ zitadel-apply complete")
		fmt.Fprintf(stderr, "  org=%s project=%s app=%s machine-user=%s\n",
			state.OrgID, state.ProjectID, state.OIDCAppID, state.MachineUserID)
	}
	return nil
}

func loadConfig(grantsOnly, noBWS bool, outputFile string) (Config, error) {
	cfg := Config{
		BaseURL:       envOr("ZA_BASE_URL", "https://auth.iedora.com"),
		MenuHostname:  envOr("ZA_MENU_HOSTNAME", "menu.iedora.com"),
		SSHHost:       os.Getenv("ZA_SSH_HOST"),
		GrantsOnly:    grantsOnly,
		MenuDNSBudget: parseDurationOr(os.Getenv("ZA_MENU_DNS_BUDGET"), 90*time.Second),
	}
	// Don't require the SA key here — `ensureSAKey` handles the cold
	// path (missing in env + BWS → fetch from box via SSH). loadConfig
	// just records whatever happens to be in env.
	cfg.SAKeyJSON = os.Getenv("IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON")

	emails, err := parseEmails(os.Getenv("ZA_ADMIN_EMAILS"))
	if err != nil {
		return cfg, err
	}
	cfg.AdminEmails = emails

	store, err := buildStore(noBWS, outputFile)
	if err != nil {
		return cfg, err
	}
	cfg.Store = store

	return cfg, nil
}

func buildStore(noBWS bool, outputFile string) (secretStore, error) {
	if !noBWS {
		pid, err := bws.ProjectID(context.Background())
		if err != nil {
			return nil, fmt.Errorf("resolve BWS project id: %w", err)
		}
		return newBWSStore(pid), nil
	}
	// Dev mode. Seed from the previous output file (if any) so re-runs
	// stay stable — same PAT + signing keys across `task dev` cycles.
	seed, err := loadSeedJSON(outputFile)
	if err != nil {
		return nil, fmt.Errorf("read seed %s: %w", outputFile, err)
	}
	return newMemoryStore(seed, outputFile), nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseDurationOr(s string, fallback time.Duration) time.Duration {
	if s == "" {
		return fallback
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return fallback
	}
	return d
}

// parseEmails accepts a JSON array (`["a@x","b@x"]`) or a
// comma-separated list (`a@x,b@x`) — first form matches the prior
// `ZG_EMAILS` shape, second is more operator-friendly.
func parseEmails(s string) ([]string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if strings.HasPrefix(s, "[") {
		var out []string
		if err := json.Unmarshal([]byte(s), &out); err != nil {
			return nil, fmt.Errorf("parse ZA_ADMIN_EMAILS as JSON: %w", err)
		}
		return out, nil
	}
	parts := strings.Split(s, ",")
	clean := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			clean = append(clean, p)
		}
	}
	return clean, nil
}
