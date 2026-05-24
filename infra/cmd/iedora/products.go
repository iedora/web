package main

import (
	"path/filepath"
)

// product describes one deployable artifact alongside the central infra.
// Each entry in `products` becomes one fan-out goroutine in
// runDeployProduct / runDestroyProduct.
//
// Polymorphism lives on `runtime` — see runtime.go for the interface,
// runtime_docker.go / runtime_cf.go for the two implementations.
//
// Adding a product:
//
//  1. Decide on a runtime (or implement a new one — runtime_*.go).
//  2. Append one entry to `products` below.
//  3. Add a .github/workflows/<name>.yml workflow that build-pushes the
//     artifact and triggers deploy.yml with product=<name>.
//
// The orchestrator picks up the rest mechanically.
type product struct {
	// name — human label, surfaced in stderr lines. Lowercase, no spaces.
	// Used as the workflow_call input to .github/workflows/deploy.yml.
	name string

	// runtime — how this product is shipped. Two implementations today
	// (dockerOnHetzner, cloudflareWorker). Adding a third (Vercel,
	// Cloudflare Pages, etc.) = new struct in runtime_<kind>.go.
	runtime productRuntime
}

// products — the explicit registry. Order is irrelevant; deploy/destroy
// fan out in parallel.
var products = []product{
	{
		name:    "house",
		runtime: &cloudflareWorker{
			productName: "house",
			infraRel:    "products/house/infra",
			siteRel:     "products/house",
			build:       []string{"bun", "run", "build"},
		},
	},
	{
		name: "menu",
		runtime: &dockerOnHetzner{
			containerName:  "infra-menu-web",
			imageRepo:      "ghcr.io/eduvhc/menu",
			imageSHAEnv:    "MENU_IMAGE_SHA",
			networkName:    "iedora",
			networkAliases: []string{"infra-menu-web"},
			restart:        "unless-stopped",
			cmd: []string{"node", "server.js"},
			// Migrations are NOT here — they're a Stage 3 configurator
			// (`infra/cmd/menu-migrate/`, registered in
			// `appConfigurators`). Stage 4 hits an already-migrated DB.
			logOpts: map[string]string{
				"max-size": "10m",
			},
			envStatic: map[string]string{
				"NODE_ENV":                "production",
				"NEXT_TELEMETRY_DISABLED": "1",
				"S3_REGION":               "auto",
			},
			// Zitadel app-state outputs (Stage 3 writes these) + the
			// shared AUTOGEN_* secrets (Tofu mints + writes via
			// terraform_data.bws_sync_autogen). Stage 4 reads BWS at
			// deploy time and injects via `docker run -e`.
			// App secrets the runtime mints on first deploy. Tofu does
			// not manage these — they have no IaC consumer.
			appSecrets: []appSecret{
				{bwsKey: "DEPLOY_MENU_SESSION_SECRET", length: 32}, // 256-bit JWE key
			},
			envFromBWS: map[string]string{
				"APP_ZITADEL_MENU_OIDC_CLIENT_ID":     "ZITADEL_OAUTH_CLIENT_ID",
				"APP_ZITADEL_MENU_OIDC_CLIENT_SECRET": "ZITADEL_OAUTH_CLIENT_SECRET",
				"APP_ZITADEL_MENU_SA_TOKEN":           "ZITADEL_MANAGEMENT_TOKEN",
				"APP_ZITADEL_PERMISSIONS_SIGNING_KEY": "ZITADEL_ACTION_SIGNING_KEY",
				"APP_ZITADEL_GRANTS_SIGNING_KEY":      "ZITADEL_GRANTS_SIGNING_KEY",
				"APP_ZITADEL_IEDORA_PROJECT_ID":       "IEDORA_PROJECT_ID",
				"DEPLOY_MENU_SESSION_SECRET":     "MENU_SESSION_SECRET",
			},
			// Central-root Tofu outputs that aren't in BWS — composed
			// values from random_password + variables. Added to
			// outputs.tf when this lands.
			envFromTofu: map[string]string{
				"menu_database_url":          "DATABASE_URL",
				"menu_public_url":            "MENU_PUBLIC_URL",
				"zitadel_issuer_url":         "ZITADEL_ISSUER_URL",
				"menu_iedora_admin_emails":   "IEDORA_ADMIN_EMAILS",
				"menu_s3_endpoint":           "S3_ENDPOINT",
				"menu_s3_public_url":         "S3_PUBLIC_URL",
				"menu_s3_bucket":             "S3_BUCKET",
				"menu_s3_access_key":         "S3_ACCESS_KEY",
				"menu_s3_secret_key":         "S3_SECRET_KEY",
				"menu_otel_endpoint":         "OTEL_EXPORTER_OTLP_ENDPOINT",
				"menu_otel_headers":          "OTEL_EXPORTER_OTLP_HEADERS",
				"menu_host_name":             "HOST_NAME",
			},
		},
	},
}

// repoRoot is `<infraDir>/..` — same resolution every product path
// here is built on.
func repoRoot() string { return filepath.Dir(infraDir()) }
