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
// Mode — Rule 1 of the environment guardrails. Every invocation runs in
// exactly one mode:
//
//	--mode live   writes outputs to BWS; gated by DNS + TLS probes (prod)
//	--mode local  writes outputs as JSON to --output-file; in-memory store (dev)
//
// Inputs (env, set by `bin/with-secrets` for prod or the dev orchestrator):
//
//	IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON  full SA key JSON (the file FirstInstance writes)
//	ZA_BASE_URL                Zitadel base URL; defaults to https://auth.iedora.com
//	ZA_MENU_HOSTNAME           menu's public hostname; defaults to menu.iedora.com
//	ZA_ADMIN_EMAILS            JSON array OR comma-separated list of admin emails
//	ZA_SSH_HOST                Hetzner IPv4 for the menu-DNS gate; live mode only.
//	                           Falls back to IAC_BOOTSTRAP_HOST_IP if unset (which
//	                           is what `bin/with-secrets --stage app` already exports).
//	ZA_MENU_DNS_BUDGET         optional poll budget (e.g. "90s"); default 90s
//
// Flags:
//
//	--mode live|local    binary environment guardrail (default: live)
//	--grants-only        skip full reconcile, only run admin email grants
//	--output-file PATH   when --mode local, serialise outputs as JSON to PATH
//	                     (also seeds the store from this path if it exists,
//	                     so warm dev runs keep stable PAT + signing keys)
//	--allow-recreate L   comma-separated resources allowed to delete+recreate
//	                     in live mode when their BWS key is missing. Default
//	                     empty = strict (Rule 5 anti-panic lock — refuses
//	                     destructive recovery without explicit opt-in).
//	                     Tokens: "pat", "target:menu-permissions",
//	                     "target:menu-grants".
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
	"github.com/eduvhc/iedora/infra/internal/mode"
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
	modeFlag := fs.String("mode", string(mode.Live), "binary environment guardrail: live | local")
	outputFile := fs.String("output-file", "", "when --mode local, serialise outputs as JSON to PATH")
	// Rule 5 (anti-panic lock): comma-separated list of resources the
	// reconciler is allowed to delete+recreate in live mode when their
	// BWS key is missing. Default empty = strict (refuse + error).
	// Known tokens: "pat", "target:menu-permissions", "target:menu-grants".
	// See docs/deploy.md § Environment guardrails (Rule 5).
	allowRecreate := fs.String("allow-recreate", "",
		"comma-separated resources to allow delete+recreate on BWS miss in live mode (e.g. pat,target:menu-permissions)")
	if err := fs.Parse(argv); err != nil {
		return err
	}

	m, err := mode.Resolve(*modeFlag)
	if err != nil {
		return err
	}

	cfg, err := loadConfig(*grantsOnly, m, *outputFile)
	if err != nil {
		return err
	}
	cfg.AllowRecreate = parseAllowRecreate(*allowRecreate)

	// Self-bootstrap: if the SA key isn't already in env, TLS-probe
	// Zitadel + fetch the FirstInstance key off the box. Keeps Stage 3's
	// orchestrator (cmd/iedora/app.go) dumb — it doesn't need to know
	// anything Zitadel-specific.
	if cfg.SAKeyJSON == "" {
		key, err := ensureSAKey(ctx, cfg, m)
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

func loadConfig(grantsOnly bool, m mode.Mode, outputFile string) (Config, error) {
	cfg := Config{
		BaseURL:      envOr("ZA_BASE_URL", "https://auth.iedora.com"),
		MenuHostname: envOr("ZA_MENU_HOSTNAME", "menu.iedora.com"),
		// SSHHost resolves from ZA_SSH_HOST first (explicit override) and
		// falls back to IAC_BOOTSTRAP_HOST_IP — the BWS-written Hetzner
		// IPv4 that's already in env via `bin/with-secrets --stage app`.
		// Neither the iedora orchestrator nor app-state.yml exports
		// ZA_SSH_HOST today, so without this fallback the live
		// menu-DNS gate would error out (per wait_dns.go). cmd/dev
		// explicitly sets ZA_SSH_HOST="" to suppress the gate in local.
		SSHHost:       envOr("ZA_SSH_HOST", os.Getenv("IAC_BOOTSTRAP_HOST_IP")),
		Mode:          m,
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

	store, err := buildStore(m, outputFile)
	if err != nil {
		return cfg, err
	}
	cfg.Store = store

	return cfg, nil
}

func buildStore(m mode.Mode, outputFile string) (secretStore, error) {
	switch m {
	case mode.Live:
		pid, err := bws.ProjectID(context.Background())
		if err != nil {
			return nil, fmt.Errorf("resolve BWS project id: %w", err)
		}
		return newBWSStore(pid), nil
	case mode.Local:
		// Seed from the previous output file (if any) so re-runs stay
		// stable — same PAT + signing keys across `task dev` cycles.
		seed, err := loadSeedJSON(outputFile)
		if err != nil {
			return nil, fmt.Errorf("read seed %s: %w", outputFile, err)
		}
		return newMemoryStore(seed, outputFile), nil
	default:
		return nil, fmt.Errorf("unsupported mode %q", m)
	}
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

// parseAllowRecreate splits a comma-separated --allow-recreate value
// into a lookup map. Empty/whitespace-only input → nil map (treated as
// strict). Per-token trimming so `--allow-recreate=pat, target:menu-grants`
// works the same as `pat,target:menu-grants`. Unknown tokens are kept —
// validating them against an allowlist here would couple this helper
// to the schema (which lives in reconcile.go), and an unknown token
// is a silent no-op (the gate just never matches it) which is the
// safer failure mode than a flag-parse-time error blocking the rest
// of the run.
func parseAllowRecreate(s string) map[string]bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	out := map[string]bool{}
	for tok := range strings.SplitSeq(s, ",") {
		tok = strings.TrimSpace(tok)
		if tok != "" {
			out[tok] = true
		}
	}
	return out
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
