package main

// product here means a DEPLOY ARTIFACT — one image-and-runtime pair the
// orchestrator can ship. NOT a logical product surface.
//
// The codebase has two workspace packages that supply surfaces to the
// web container:
//   - @iedora/product-menu  (slices, drizzle, e2e — menu.iedora.com)
//   - @iedora/product-core  (auth + admin guards — core.iedora.com)
//
// And the apex brand landing for iedora.com lives directly under
// `apps/web/src/app/house/` — it was small enough that the workspace
// abstraction wasn't worth it (Opt-B refactor, May 2026).
//
// All three surfaces ship inside the same Next.js shell (`apps/web`),
// built into ONE Docker image (`ghcr.io/eduvhc/web`), running in ONE
// container (`infra-web`). Host-based rewrites in
// `apps/web/src/proxy.ts` fan the three subdomains (menu., core.,
// apex iedora.com) onto the same node process. So at the deploy
// layer there is exactly ONE entry — the `web` artifact below.
//
// A future product that needs a DIFFERENT runtime (Cloudflare Workers,
// Vercel, static S3, …) would add a second entry here with its own
// runtime_<kind>.go. Until then, "adding a product" is a workspace-
// package + proxy-rewrite operation, NOT a registry edit.
//
// Polymorphism lives on `runtime` — see runtime.go for the interface,
// runtime_docker.go for the only implementation today.
//
// Adding a NEW deploy artifact (separate runtime):
//
//  1. Implement a new productRuntime in runtime_<kind>.go.
//  2. Append one entry to `products` below.
//  3. Add a .github/workflows/<name>.yml workflow that build-pushes
//     the artifact and triggers deploy.yml with product=<name>.
//
// The orchestrator picks up the rest mechanically.
type product struct {
	// name — human label, surfaced in stderr lines. Lowercase, no spaces.
	// Used as the workflow_call input to .github/workflows/deploy.yml.
	// Matches the deploy artifact, not the logical product surface.
	name string

	// runtime — how this artifact is shipped. One implementation today
	// (dockerOnHetzner). Adding another (Vercel, Cloudflare Pages, etc.) =
	// new struct in runtime_<kind>.go.
	runtime productRuntime
}

// products — the explicit registry of deploy artifacts. Order is
// irrelevant; deploy/destroy fan out in parallel.
//
// One entry: `web` — the Next.js shell hosting all three logical
// products (menu, core, house). See the type comment above.
var products = []product{
	{
		name: "web",
		runtime: &dockerOnHetzner{
			containerName:  "infra-web",
			imageRepo:      "ghcr.io/eduvhc/web",
			imageSHAEnv:    "IMAGE_SHA",
			networkName:    "iedora",
			networkAliases: []string{"infra-web"},
			restart:        "unless-stopped",
			cmd:            []string{"node", "server.js"},
			// Migrations are NOT here — they're a Stage 3 configurator
			// (`infra/app-state/cmd/menu-db-migrations/`, registered in
			// `appConfigurators`). Stage 4 hits an already-migrated DB.
			logOpts: map[string]string{
				"max-size": "10m",
			},
			// Guardrail #4 — opts web into the zero-downtime hot-swap
			// flow. Probe `/up` (returns 200 `{"ok":true,"db":"ok"}` on
			// healthy DB connectivity) on container-local port 3000
			// until ready, then atomically re-alias `infra-web`
			// from the old container to the new one. Timeout / Interval /
			// DrainDuration left zero → defaults (60s / 500ms / 10s).
			Healthcheck: &Healthcheck{Path: "/up", Port: 3000},
			envStatic: map[string]string{
				"NODE_ENV":                      "production",
				"NEXT_TELEMETRY_DISABLED":       "1",
				"S3_REGION":                     "auto",
				"IEDORA_BOOTSTRAP_ADMIN_EMAILS": "eduardoferdcarvalho@gmail.com",
			},
			// App secrets the runtime mints on first deploy + writes
			// to BWS. Tofu doesn't manage these — they have no IaC
			// consumer.
			appSecrets: []appSecret{
				{bwsKey: "DEPLOY_CORE_SECRET", length: 48},
			},
			envFromBWS: map[string]string{
				"DEPLOY_CORE_SECRET": "CORE_SECRET",
			},
			// Infra-static Tofu output mappings (databases, S3, OTel,
			// host). Surface URL env vars + CORE_TRUSTED_ORIGINS come
			// in via envFromTofuJSON below — Tofu's `surface_envs`
			// output builds the map from var.surfaces, so adding a
			// surface requires NO edit here.
			envFromTofu: map[string]string{
				// tofu output name → container env var name
				"menu_database_url":    "MENU_DATABASE_URL",
				"core_database_url":    "CORE_DATABASE_URL",
				// imopush_database_url is declared but the Tofu module
				// hasn't emitted it yet (imopush isn't Stage-4 deployable
				// — no per-product container, no DNS, no tunnel ingress).
				// Listing the mapping here means: the moment the Tofu
				// output lands, the web container picks it up without
				// another code change. Until then, the imopush surface
				// routes on apps/web are unreachable from prod (no host
				// rewrite + no DB env), which is the intended state.
				"imopush_database_url": "IMOPUSH_DATABASE_URL",
				"assets_s3_endpoint":   "S3_ENDPOINT",
				"assets_s3_public_url": "S3_PUBLIC_URL",
				"assets_s3_bucket":     "S3_BUCKET",
				"assets_s3_access_key": "S3_ACCESS_KEY",
				"assets_s3_secret_key": "S3_SECRET_KEY",
				"otel_endpoint":        "OTEL_EXPORTER_OTLP_ENDPOINT",
				"otel_headers":         "OTEL_EXPORTER_OTLP_HEADERS",
				"host_name":            "HOST_NAME",
			},
			// surface_envs — a Tofu map output, expanded into env at
			// resolve time. Keys: NEXT_PUBLIC_<X>_URL, CORE_BASE_URL,
			// CORE_TRUSTED_ORIGINS, etc. Derived from var.surfaces.
			envFromTofuJSON: []string{"surface_envs"},
		},
	},
}
