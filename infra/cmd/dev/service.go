package main

import "sort"

type category string

const (
	catInfra    category = "infra"
	catProducts category = "products"
)

// service is a single entry in the dev stack catalog. Every field is
// declarative — the orchestrator runs against the slice, not against
// hardcoded service names.
type service struct {
	name    string   // selection key + TF enable_* suffix + TUI label
	tfVar   string   // empty for products (they're presets, not TF gates)
	deps    []string // transitive selection deps (other service.name values)
	cat     category
	hostRun bool // true if launched on the host (next dev), false if TF-managed

	// menu env keys this service provides locally. When the service is
	// excluded from the dev stack (--except <name>), these keys are
	// dropped from .env (no local listener to point at) and added to
	// .env.local as `<please_fill>` so the operator points them at a
	// remote URL (homelab, prod, etc) themselves.
	//
	// Keep in sync with the menu_env module's env_map. Only keys whose
	// VALUE varies by where the service runs need to be here — fixed
	// config (e.g. S3_ACCESS_KEY=test) stays in .env regardless, since
	// it works the same against any LocalStack instance.
	envKeys []string
}

// Ordered for deterministic UI rendering.
//
// `zitadel` is NOT in this list — it's mandatory infrastructure for
// every dev workflow (the menu app has no auth path that doesn't go
// through it, and the seed phase that mints OIDC client_id/secret
// can't run without a live local Zitadel). It's always booted by
// `tofu apply` regardless of user selection. See dev/tofu/main.tf —
// `var.enable_zitadel` stays around for CI scenarios that don't need
// it (e.g. testing postgres in isolation) but the CLI doesn't expose
// it. The architectural decision is documented in
// docs/infra/auth.md + the menu auth slice's docs.
var allServices = []service{
	{name: "postgres", tfVar: "enable_postgres", cat: catInfra,
		envKeys: []string{"DATABASE_URL"}},
	{name: "localstack", tfVar: "enable_localstack", cat: catInfra,
		envKeys: []string{"S3_ENDPOINT", "S3_PUBLIC_URL"}},
	{name: "openobserve", tfVar: "enable_openobserve", deps: []string{"localstack"}, cat: catInfra,
		envKeys: []string{"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"}},
	{name: "house", tfVar: "enable_house", cat: catProducts},
	// `menu` runs in a docker container (same image shape as prod).
	// For HMR, opt out via `--except menu` and `cd products/menu && bun run dev`
	// — `.env` + `.env.local` are written with localhost-DNS for that
	// path. Default path is the container: no HMR, but identical to prod.
	//
	// menu's deps don't list zitadel because zitadel is always-on
	// (not in allServices). The TF code still gates the menu container
	// on local.seed_active which requires zitadel to be up.
	{name: "menu", tfVar: "enable_menu", deps: []string{"postgres", "localstack", "openobserve"}, cat: catProducts},
}

func serviceByName(n string) (service, bool) {
	for _, s := range allServices {
		if s.name == n {
			return s, true
		}
	}
	return service{}, false
}

func defaultSelection() []string {
	out := make([]string, 0, len(allServices))
	for _, s := range allServices {
		out = append(out, s.name)
	}
	return out
}

// expandDeps closes `selected` over `service.deps`. Result is sorted.
func expandDeps(selected []string) []string {
	set := map[string]bool{}
	var dfs func(string)
	dfs = func(n string) {
		if set[n] {
			return
		}
		set[n] = true
		s, ok := serviceByName(n)
		if !ok {
			fail("unknown service %q", n)
		}
		for _, d := range s.deps {
			dfs(d)
		}
	}
	for _, n := range selected {
		dfs(n)
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// excludedServiceEndpoints returns the env keys whose producing service
// was excluded from the dev stack. The keys get dropped from `.env`
// (no local listener to point at) and added to `.env.local` as
// `<please_fill>` so the operator points them at a remote (homelab
// tunnel, prod URL, etc).
//
// Driven by the `envKeys` field on each service entry in `allServices`
// — adding a new service with menu-env-affecting keys is a one-line
// change there, no extra wiring here.
func excludedServiceEndpoints(selected []string) []string {
	var out []string
	for _, s := range allServices {
		if len(s.envKeys) == 0 || contains(selected, s.name) {
			continue
		}
		out = append(out, s.envKeys...)
	}
	return out
}

// contains is a stable membership check used across the orchestrator.
// Kept here so service.go is self-contained — selection.go, envfile.go,
// etc. all import this package and reach for it.
func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
