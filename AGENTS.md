<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> This is a **Bun-workspaces monorepo**. One Next.js product
> (`products/menu/`), one Astro static site (`products/house/`),
> and three workspace packages (`packages/design-system/`,
> `packages/iedora-identity/`, `packages/iedora-observability/`).
> `bun install` runs ONCE at the repo root and resolves every workspace;
> you almost never `cd` to install.
>
> Paths starting with `src/...` are relative to the product
> directory the rule talks about. The house product is a static
> landing page; it has no code-level conventions beyond
> `products/house/README.md`.

## What this is

**iedora** is the umbrella. Two products live under it:

- **Menu** (menu.iedora.com — `products/menu/`) — a SaaS multi-tenant
  restaurant menu builder. Each tenant is an organization that owns
  one or more `restaurant` rows. Admins build menus via drag-and-drop;
  the public menu renders from the same data.
- **House** (iedora.com — `products/house/`) — the umbrella brand
  landing page. Astro static output, deployed to Cloudflare Workers
  Static Assets. Deliberately small. No DB, no auth.

> **Identity (genkan → Zitadel).** The original `products/genkan/`
> IdP (Better Auth + `@better-auth/oauth-provider`) has been
> deleted. Identity is moving to **Zitadel** (self-hosted at
> `auth.iedora.com` — issue #19). Phase 1 (Zitadel running
> alongside the old genkan in infra) is in; Phases 3+ (menu cuts
> over to Zitadel as the actual IdP) are future work. Until then,
> menu's `src/features/identity/` adapter is effectively dead code.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components) — menu.
- **TypeScript** strict — every workspace.
- **Drizzle ORM** + `postgres-js` driver, **Postgres 18**.
- **Better Auth 1.6.11** — pinned exact in menu. Currently used
  for menu's local session layer; the federated IdP role moves
  to Zitadel under issue #19.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives
  (Wordmark, Card, Dialog, …) come from
  **`@iedora/design-system`** for both products.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator.
  `bun install` at the repo root resolves every workspace; the
  workspace lockfile is `bun.lock`. **Production runtime is
  Node** — `bun + next build` is unstable as of 2026
  (oven-sh/bun#23944), and `next start` runs under Node in the production container.

## Hard rules — per product

Each product owns its own CLAUDE.md with its product-specific hard rules. Claude Code auto-loads the relevant one when you work under that subtree, keeping context lean.

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 14 menu-specific rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), no middleware.ts (it's `proxy.ts` in Next 16), money in cents, dnd-kit position columns, open/closed template + language + plan registries, public-menu cache invalidation by tag, beacon-based view tracking, vertical slice boundaries.
- **[products/house/CLAUDE.md](products/house/CLAUDE.md)** — deliberately no code-level rules (static Astro on Workers Static Assets).

## Pattern: how to add a feature

Reference template: `src/features/auth/` in menu.

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}` — `ui/` only if the slice owns React components.
2. Define **`ports.ts`** — narrow interfaces describing every effect the slice needs (db reads/writes, external APIs). One method per atomic op; no Drizzle / Next types leak through.
3. Write the production **`adapters/drizzle.ts`** (or `better-auth.ts`, `s3.ts`, …). Marked `'server-only'`. Implements the port against the real world.
4. Write **`use-cases/<verb>.ts`** as pure-ish async functions: `(port, input) => result`. No `redirect()` / `headers()` access except via the port — that's what lets Vitest run them against PGLite.
5. Expose the slice via **`index.ts`** — `React.cache()`-memoize page loaders that fan out to children. Re-export types callers need. Don't export the adapter itself.
6. If the slice has mutations, add **`actions.ts`** with `'use server'` at the top: auth guard → `runUseCase(productionAdapter, input)` → `revalidateRestaurant(slug)`. Server actions don't live in `index.ts` — Next's directive doesn't traverse barrels reliably.
7. Add a co-located **`<slice>.test.ts`** next to the source — `makeTestDb()` from `@/shared/testing/pglite`, real Drizzle queries, fakes only at the port boundary.
8. Add a short **`README.md`** at the slice root documenting the public API.

For asset targets, languages, plans, templates: the registry
pattern is already encoded in the matching skill
(`add-asset-target`, `add-language`, `add-template`).

## File layout

The repo is a Bun workspace: `bun.lock` at the root, every
workspace under `packages/*` or `products/*`. Each product's
deploy stack is independently appliable — BWS credentials and
the Cloudflare zone live inside the product, not in shared infra.

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + products/{menu,house}
  justfile                               just modules: infra::, menu::, house::
  .github/                               composite setup action + one workflow per workspace
    actions/setup/action.yml             composite: install Bun + bun install --frozen-lockfile
    workflows/menu.yml                   menu's full pipeline (typecheck + lint + unit + e2e)
    workflows/design-system.yml          design-system pipeline (typecheck + lint + unit)
    workflows/identity.yml               iedora-identity pipeline (typecheck + lint + unit + fuzz)
    workflows/observability.yml          iedora-observability pipeline (typecheck + lint + unit)
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs (deploy, scaling, backups, secrets,
                                         security-audit, tenancy, vendors, architecture, testing)

  infra/                                 SHARED INFRASTRUCTURE — the single deploy entry point.
                                         Postgres + backups + OpenObserve + Zitadel + Caddy +
                                         the menu_web app container all live here as Tofu-managed
                                         Docker containers on the Hetzner VPS. Container names
                                         are `infra-*` for cross-product accessories; the menu
                                         app container is named `menu_web`.
    justfile                             deploy / backup / restore / wipe-postgres / build-backup
    .env.example                         infra template (BWS token + ONPREM_HOST + GHCR_USER + CF acct)
    bin/with-secrets                     BWS wrapper; exports TF_VAR_* aliases (cloudflare/github
                                         bootstrap + onprem_host + per-container BWS-sourced secrets)
    tofu/                                Single Tofu root. R2 buckets + GitHub Actions config +
                                         docker_container resources on the Hetzner VPS via
                                         `kreuzwerker/docker` over SSH. See containers.tf.
    backup/                              self-built Postgres-backup image (Dockerfile + backup.sh + restore.sh + run.sh)

  packages/
    eslint-config/                       @iedora/eslint-config — flat-config factories shared by
                                         every workspace. Compose `base + typescript + next +
                                         react + boundaries({ elements }) + vitest` per package.
                                         See packages/eslint-config/README.md for the consumer
                                         shape and why per-package over single-root config.
      src/
        index.js                         barrel: base, typescript, next, react, boundaries, vitest
        base.js, typescript.js, …        one factory per file
      README.md                          consumer recipe + design rationale
    design-system/                       @iedora/design-system — editorial CSS + React primitives
      src/
        index.ts                         component barrel (Wordmark, Card, Dialog, Button, …)
        components/                      ~25 primitives — see README's §VI listing
        styles.css                       paper/ink/cinnabar palette + Manual classes
        tokens.css, fonts.css            CSS custom properties + (optional) Fraunces/JBMono
      README.md                          quickstart + design intent
    iedora-identity/                     @iedora/identity — webhook sender+receiver+envelope
      src/
        index.ts                         barrel
        events.ts                        IdentityEvent union (source of truth, both ends)
        signature.ts                     Stripe-style x-iedora-signature header
        sender.ts                        signs, POSTs, retries on 5xx, gives up on 4xx
                                         + injects W3C traceparent for cross-product trace stitching
        receiver.ts                      verify + dedup + handler dispatch
                                         + extracts traceparent before handler runs
        ssrf.ts                          DNS-resolve + private-CIDR reject (rebind gap noted)
        secret-storage.ts                AES-256-GCM HKDF cipher used for stored webhook secrets
        __tests__/                       crypto + parsing unit tests (no DB)
      README.md                          surface + security model
    iedora-observability/                @iedora/observability — one-line OTel wiring per product (traces + metrics)
      src/
        index.ts                         barrel (registerIedoraOtel, tracer, meter, withTenantSpan, tenantAttributes)
        register.ts                      wraps @vercel/otel — resource attrs + sampler + noise filter + 60s metrics reader
        tracer.ts                        pre-configured Tracer for custom spans
        meter.ts                         pre-configured Meter for counters / histograms / gauges
        tenant.ts                        withTenantSpan + tenantAttributes + IEDORA_RESTAURANT_ID/ORGANIZATION_ID
        __tests__/                       no-op-in-tests, tenant attribute contract, tenant-isolation contracts
      README.md                          quickstart + behaviour table

  products/
    menu/                                Next.js 16 — menu.iedora.com (SaaS menu builder)
                                         → full subtree in products/menu/CLAUDE.md
    house/                               Astro — iedora.com (brand site, static)
                                         → see products/house/CLAUDE.md + README.md
```

Menu's `infra/` shape: `Dockerfile` (consumed by `menu.yml` CI to build + push the image to GHCR), `justfile` (recipes for the R2 assets bucket + DNS), `.env.example`, `bin/with-secrets` (BWS wrapper), `tofu/` (encrypted Cloudflare state for the assets bucket + `assets.iedora.com` custom domain). The menu container itself is declared in `infra/tofu/containers.tf` at the repo root (`docker_container.menu_web`) — applied by `just infra::deploy`.

## Useful commands

`bun install` runs ONCE at the repo root. The workspace lockfile
covers every package and product; you almost never need to install
inside a sub-package. Dev/test/build scripts run inside the product
or package directory.

### Repo-root commands

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — what CI uses; matches `bun.lock` exactly.
- `just` — list every product module + its recipes.
- `just menu` / `just house` — list one product's recipes.

### Per-product commands

- **Menu** — see [products/menu/CLAUDE.md](products/menu/CLAUDE.md) § Commands.
- **Packages** (`packages/<name>/`) — `bun run test` / `test:watch` (Vitest; no DB for `@iedora/identity` and `@iedora/observability`, jsdom for `@iedora/design-system`); `bun run typecheck`.

### Deploy (`just <product>::<recipe>` at repo root)

- **First-time setup** (once, manual): root SSH key on the Hetzner box (cloud images ship with it); `gh auth refresh -s write:packages`; populate the bootstrap secrets in BWS; then `just infra::deploy` — one `tofu apply` boots Postgres + backups + Zitadel + Caddy + the menu container in one pass. See `docs/deploy.md`.
- `just infra::deploy` — the single deploy entry point. Tofu provisions the Hetzner VPS, every Cloudflare resource, the GitHub Actions config, and every container on the box (`infra-postgres`, `infra-backups`, `infra-openobserve`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `menu_web`). Idempotent — same recipe day-1 and day-N.
- `just menu::infra` — applies the menu-product-local Tofu (assets R2 bucket + `assets.iedora.com` DNS). Rare — only when the bucket or its CORS / custom-domain configuration changes.
- `just infra::logs <svc>` / `just infra::console` — tail logs / psql shell on the live box via SSH.
- `just infra::backup` / `restore` — force a Postgres dump now / restore latest (interactive). Backups are cluster-wide (`pg_dumpall`) and cover every product's database.
- `just infra::build-backup` — rebuild the backup container image (only needed when bumping the Postgres major).
- `just infra::rotate-secret <KEY>` — rotate one BWS secret (prompts new value, edits BWS, reminds to redeploy). For sub-tokens (R2, tunnel): `bin/with-secrets tofu -chdir=tofu apply -replace=<resource>` inside the right workspace. See `docs/secrets.md`.
- `just infra::destroy` — tears down the Hetzner VPS + every Tofu-managed resource.
- `just house::deploy` / `house::destroy` — manage iedora.com (Astro build → workload-token refresh → `wrangler deploy` uploading dist/ + apex `custom_domain` route). `just house::build` / `house::preview` for local-only checks.

`just` itself is a Rust task runner — `brew install just` on macOS,
`cargo install just` on the VPS. Replaces the old root + infra
Makefiles.

Image build + push happens **in CI** (`.github/workflows/menu.yml`)
on every push to main: buildx for `linux/arm64` (the Hetzner CAX11 is
ARM), pushed to **GHCR** (`ghcr.io/$GHCR_USER/menu:latest` + commit
SHA). Menu CI then dispatches `infra-deploy.yml`, which re-runs
`tofu apply`; Tofu's `data.docker_registry_image.menu + pull_triggers`
pulls the new digest and recreates the `docker_container.menu_web`
in-place. No SSH from CI, no local builder.

## CI

**One workflow file per workspace** — every product and every shared
package owns its own `.github/workflows/<name>.yml`. Each file is
self-contained: own trigger paths, own env block, own job graph.
Adding a new workspace = one new file.

```
.github/
  actions/setup/action.yml      composite: install Bun + bun install --frozen-lockfile
  workflows/
    menu.yml                     menu's full pipeline (typecheck, lint, unit, security, build + push image)
    design-system.yml            @iedora/design-system unit suite
    identity.yml                 @iedora/identity unit suite
    observability.yml            @iedora/observability unit suite
    infra-deploy.yml             one `tofu apply` for the whole estate; auto-triggers on green menu.yml
    house-deploy.yml             house CD (Astro → wrangler deploy)
    codeql.yml                   CodeQL SAST (TS+JS); push + PR + weekly cron
    scorecard.yml                OpenSSF Scorecard posture grading; weekly cron
    dependency-review.yml        block PRs that add HIGH/CRITICAL CVE deps
```

**Two load-bearing decisions:**

1. **`paths:` trigger filter per workflow.** Each workflow's `on:`
   block lists the workspaces that should retrigger it. Menu lists
   `products/menu/**` plus its workspace deps (`design-system`,
   `identity`) plus root files (`bun.lock`, `package.json`,
   `tsconfig*.json`, its own workflow file, the composite action).

2. **Composite action for setup.** `actions/setup` runs
   `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` at the
   repo root. Every job that needs deps is one line:
   `uses: ./.github/actions/setup`. Bumping Bun or adding a cache
   layer is a one-file edit, applies to all workflows.

**The jobs (per file):**

- **menu.yml** — `typecheck`, `lint`, `unit`, `security` (parallel),
  then `e2e` with `needs: [typecheck, lint, unit, security]`. The
  e2e job owns the entire env block (Postgres + LocalStack services,
  S3_* / DATABASE_URL literals) — they're all menu-specific.
  The security job runs `aquasecurity/trivy-action` (fs scan, fails
  on HIGH/CRITICAL via `--ignore-unfixed`) and emits an SPDX-JSON
  SBOM uploaded as a 90-day artifact.
- **design-system.yml** — `unit` (jsdom-backed Vitest).
- **identity.yml** — `unit` (pure crypto + parsing).
- **observability.yml** — `unit` (no-op-in-tests contract + tenant
  attribute pins). No network, no DB.
- **codeql.yml** — GitHub-native SAST. Runs on push/PR to main and
  weekly Mon 04:30 UTC. `security-extended` query suite. Findings in
  Security tab → Code scanning, grouped by language.
- **scorecard.yml** — OpenSSF Scorecard. Runs Mon 05:00 UTC, publishes
  results to OpenSSF's public API (enables a `scorecard` badge if we
  want one in README). Two known low scores: Branch-Protection (off
  by design) and Code-Review (solo project).
- **dependency-review.yml** — `actions/dependency-review-action@v4`
  on every PR; gates on HIGH+ severity. Complements menu's
  post-merge Trivy fs scan by catching vulnerable deps at PR time.
- **infra-deploy.yml / house-deploy.yml** — CD workflows.
  `infra-deploy.yml` is one `tofu apply` for the whole iedora estate;
  it fires on `workflow_dispatch` (manual operator button) and on
  `workflow_run` after Menu CI completes green on main. Tofu's
  `pull_triggers` on `docker_image.menu` pulls the freshly-pushed image
  and recreates `docker_container.menu_web`. House goes straight to
  `wrangler deploy`. SLSA build-provenance + SBOM attestations are
  attached to the GHCR image inside `menu.yml` itself (the build job).

**Where env lives:**

- **Job-level (`env:` in menu.yml's e2e job)** — every CI fixture
  literal: `DATABASE_URL`, `S3_*`. These aren't secret — they live
  in code, not in GH Secrets.
- **GH Secrets** — only `BETTER_AUTH_SECRET` (truly sensitive). When
  deploy workflows land, true per-environment secrets graduate to
  **GitHub Environments** (`environment: production` / `staging`).

**Branch protection: deliberately NOT enabled** — solo, AI-driven
project; CI itself is the signal. This also dodges the well-known
gotcha where `paths:`-filtered workflows leave required status
checks "expected" indefinitely on unrelated PRs. Revisit when
adding collaborators.

**Dependency updates: Renovate.** Config lives at `renovate.json` (repo
root). The Renovate GitHub App is installed on this repo and runs on
its own schedule (weekly, Monday early morning Europe/Lisbon). It
auto-merges minor/patch updates after CI is green, plus security
advisories (zero-day window). Major bumps and the framework / auth-
stack / Bun toolchain pins (Next, React, Better Auth, `oven/bun`) are
deliberately held for manual review — see the `packageRules` in
`renovate.json`. False-positive Trivy findings can be allowlisted in
the `.trivyignore` file at repo root (quarterly review expected).

To pause Renovate for a specific dependency: add an entry to
`packageRules` with `"enabled": false`. To pause it entirely: comment
`@renovate-bot disable` on the dependency dashboard issue.

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/better-auth/` and the Better Auth README in node_modules — auth APIs (1.6.11 pinned in menu).
3. `node_modules/drizzle-orm/` — query builder, types.
4. `products/menu/src/features/<slice>/README.md` — every slice has a short doc describing its public API.
5. `packages/<package>/README.md` — every shared package documents its surface.
6. `docs/architecture.md` — the slice playbook (what goes where + how to add a feature).
7. `docs/testing.md` — the test pyramid (Vitest+PGLite unit; Playwright e2e).
8. `docs/security-audit.md` — the security model + audited surface.
9. `docs/tenancy.md` — how tenancy works.
10. `docs/vendors.md` — every paid + free dependency with rationale.
11. `docs/deploy.md`, `docs/secrets.md`, `docs/backups.md`, `docs/scaling.md` — ops playbooks (apply across products).
12. `docs/observability.md` — OpenTelemetry wiring (every product), OpenObserve operational notes, sampling, tenant-attribute conventions, query recipes.
13. `docs/terraform-style.md` — 10-bullet LLM-safe HCL conventions for every Tofu root + shared module in the repo. Apply before editing any `.tf`.
14. `docs/infra-declarative-roadmap.md` — what's declarative today vs. what's queued for migration; rationale for tiered priorities.
15. `docs/ai.md` — Claude Code GitHub Action (`.github/workflows/claude.yml`) + its `CLAUDE_CODE_OAUTH_TOKEN`, the `eduvhc/iedora` repo-slug gotcha, and the `.mcp.json` server inventory.

The bundled docs match installed versions — trust them over recall.
