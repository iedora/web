<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> Bun-workspaces monorepo. One Next.js product (`apps/web/`)
> serving `menu.iedora.com` (menu app), `core.iedora.com` (auth/sign-in), and `iedora.com` (house
> landing) through a Host-based rewrite in `src/proxy.ts`, plus
> workspace packages (`packages/auth/`, `packages/design-system/`,
> `packages/iedora-observability/`). `bun install` runs ONCE at the repo
> root and resolves every workspace.
>
> Paths starting with `src/...` are relative to the product directory
> the rule talks about.

## What this is

- **Menu** (menu.iedora.com — `apps/web/`) — SaaS multi-tenant restaurant menu builder. Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.
- **Core** (core.iedora.com — `apps/web/`) — better-auth sign-in surface. Served by the same Next.js process; `src/proxy.ts` routes `/core/*` paths. Backed by the `core` Postgres database via `@iedora/auth`.
- **House** (iedora.com — `apps/web/src/app/house/`) — brand landing page. Lives inside the same Next.js app; `src/proxy.ts` inspects Host and rewrites apex requests under `/house/*` internally. One container, one image, three hostnames.

**Identity is `@iedora/auth`.** A shared workspace package (`packages/auth/`) wrapping [better-auth](https://better-auth.com) — email+password, organization plugin (for tenants), admin plugin (for the cross-tenant `iedora-admin` role). The auth instance runs IN-PROCESS inside every product; there is no separate IdP service. Sessions are owned by better-auth (`core.session` table) and the `better-auth.session_token` cookie is scoped on `.iedora.com` so a login on any iedora surface is readable on every other. Backed by a dedicated `core` Postgres database (better-auth tables live in the `core` schema, same instance as `menu`). See `packages/auth/README.md` for the consumer contract and `apps/web/src/features/auth/README.md` for the menu-side wiring + the role/scope taxonomy.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components).
- **TypeScript** strict, every workspace.
- **Drizzle ORM** + `postgres-js`, **Postgres 18**.
- **`better-auth`** via the shared **`@iedora/auth`** package — in-process auth (email+password, organization, admin plugins). No separate IdP service; no OIDC client; the `better-auth.session_token` cookie scopes on `.iedora.com` so SSO works across products. Schema/migrations live in `packages/auth/`; product runtime imports `getAuth()` and mounts `/api/auth/[...all]`.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives come from **`@iedora/design-system`**.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator. **Production runtime is Node** — `bun + next build` is unstable as of 2026 (oven-sh/bun#23944); `next start` runs under Node in the production container.

## Hard rules — cross-product

Cross-product rules live in [`docs/agents/cross-product-rules.md`](docs/agents/cross-product-rules.md) and are auto-included below. Two rules today: `data-test-id` on interactive components + visible UI text via translation.

@docs/agents/cross-product-rules.md

## Hard rules — per product

Each product's CLAUDE.md is auto-loaded under its subtree.

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 17 rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), `proxy.ts` (not middleware — and now also handles Host-based rewrite for iedora.com → `/house/*`), money in cents, dnd-kit position columns, registry pattern for templates/languages/plans, public-menu cache by tag, beacon view tracking, vertical slice boundaries, co-located E2E + testing surface per slice, **redirects via `publicUrl()`**.
- **[apps/web/CLAUDE.md](apps/web/CLAUDE.md)** — 5 rules: routes vs slices boundary, proxy.ts host dispatch, shared chrome (DashboardPage), no tsconfig path aliasing, one image serves all hosts.
- **House** (iedora.com) lives at `apps/web/src/app/house/` — no separate CLAUDE.md; same cross-product rules apply.

## Slice pattern

The slice contract (file layout, cross-slice rules, the Next.js boundary, how to add a feature) lives in [`docs/agents/slice-pattern.md`](docs/agents/slice-pattern.md) and is auto-included below.

@docs/agents/slice-pattern.md

## File layout

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + apps/web
  go.mod, go.sum                         single Go module rooted at the repo root
  .github/                               composite setup action + one workflow per pipeline stage
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs

  bin/                                   Shim entry points — `go run` / `bash` wrappers operators invoke
    iedora-env                              Env-hydration helper (BWS → TF_VAR_*/AWS_*/CLOUDFLARE_ACCOUNT_ID)
    iedora                                  Stage 3 + Stage 4 orchestrator (app apply, deploy <prod>, doctor)
    dev-stack                               Local dev stack driver: compose up → menu .env
    state-bucket-bootstrap                  Stage -1 — provisions R2 bucket + token for Tofu's s3 backend
    bws-sync                                Batched Tofu BWS write/delete (single sequential pass)
                                            (menu-db-migrations + openobserve-dashboards run
                                             in-process via bin/iedora app apply)

  infra/                                 Pipeline stages — one folder per stage, nothing else.
                                         See infra/CLAUDE.md for the deep dive.
    iac/                                   Stage 2 — IaC for the shared estate
      tofu/                                  Encrypted Tofu root (VPS + CF + GH config + rendered
                                             docker-compose stack). Plain `tofu apply` — no wrappers.
                                              Files: compose.tf, sync.tf, destroy-hooks.tf, tunnel.tf,
                                              hetzner.tf, templates/{cloud-init.yml,iedora.service}.
                                             Menu container = Stage 4, NOT here.
      postgres/init.sql                      CREATE DATABASE menu / core (compose volume init)
      cmd/
        bws-sync/                            Go helper for terraform_data.bws_sync (batched)
        infra-pg-backup/                     Backup container (Go + Dockerfile, arm64 only — CAX SKUs)
        state-bucket-bootstrap/              Stage -1 — R2 bucket + token bootstrap (chicken/egg)
    app-state/                             Stage 3 — configurators (one per concern)
      core-db-migrations/                  drizzle-kit migrate against the `core` DB (better-auth schema)
      menu-db-migrations/                  drizzle-kit migrate against the `menu` DB
      openobserve-dashboards/              dashboard reconciler (SSH-L tunnel + go:embed JSONs)
    deploy/                                Stage 3 + Stage 4 router
      cmd/
        iedora/                              Configurator registry + productRuntime registry

  dev/                                   Local stack (mirror of all 4 stages, local Docker).
                                         Top-level peer of infra/ because it's not a stage —
                                         it's the offline twin used for local dev.
    docker-compose.yml                     Postgres + OpenObserve + adobe/s3mock

  internal/                              Shared Go libs (bws, cloudflare, mode, r2, ssh,
                                         testfakes, tlsprobe). Top-level so Go's `internal/`
                                         visibility scopes them to the whole module — every
                                         stage's cmd can import.

  packages/
    eslint-config/                       flat-config factories shared by every workspace
    auth/                                shared better-auth instance + Drizzle schema + AC taxonomy
    design-system/                       editorial CSS + React primitives (paper/ink/cinnabar)
    iedora-observability/                one-line OTel wiring (traces + metrics)

  apps/
    web/                                  Next.js 16 — serves menu.iedora.com, core.iedora.com,
                                          and iedora.com
      src/proxy.ts                         Host-based rewrite: iedora.com/* → /house/*
      src/app/house/                       Brand landing for iedora.com

  products/
    menu/                                Workspace package — slices, schema, i18n, templates
```

Menu's container is NOT in the compose stack rendered by `infra/iac/tofu/compose.tf` — only the shared services (postgres, cloudflared, openobserve, backups) live there. Menu's lifecycle (pull/run on every deploy) is owned by Stage 4 via [`infra/deploy/cmd/iedora/runtime_docker.go`](infra/deploy/cmd/iedora/runtime_docker.go); a Cloudflare Tunnel routes `menu.iedora.com`, `core.iedora.com`, and `iedora.com` (apex + www) to the same docker network alias so one container serves all three sites.

## Commands

### Repo-root

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — what CI uses.

### Per-product

- **Menu** — see [products/menu/CLAUDE.md](products/menu/CLAUDE.md) § Commands.
- **Packages** — `bun run test` / `test:watch` (Vitest; no DB for `@iedora/observability`, jsdom for `@iedora/design-system`); `bun run typecheck`.

### Deploy

The deploy pipeline is 4 stages. No task runner — operators invoke `tofu` and `bin/iedora` directly via `bws run`. CI uses the same commands in per-stage GitHub Actions workflows.

```
Stage 1: Build & Test      per-product (bun, docker build, tests)
Stage 2: IaC               bin/iedora-env tofu -chdir=infra/iac/tofu apply
Stage 3: AppState          bin/iedora-env bin/iedora app apply
Stage 4: Deploy            bin/iedora-env bin/iedora deploy <product>
```

- **Stage 2** — plain Tofu. `init` / `plan` / `apply` / `destroy` against `infra/iac/tofu/`. The Tofu graph renders a docker-compose document (`compose.tf`) + Cloudflare Tunnel config (`tunnel.tf`); cloud-init drops them on first boot, `terraform_data.iedora_sync` pushes day-2 changes via one SSH session. `rclone` is required on the operator's machine — destroy-time hooks (`destroy-hooks.tf`) purge R2 buckets before the API DELETE.
- **Stage 3** — `bin/iedora app apply` runs every configurator in `configurators.go` sequentially: **core-db-migrations** (better-auth schema in the `core` DB) → **menu-db-migrations** → **openobserve-dashboards**. Both migration configurators piggyback on the menu image (which has @iedora/auth as a workspace dep, so `packages/auth/{drizzle,scripts/migrate.mjs}` ship inside the standalone bundle).
- **Stage 4** — `bin/iedora deploy <product>` (or `destroy <product>`). Dispatches through the productRuntime registry (`products.go`).
- **Local dev** — `./bin/dev-stack` boots the local-twin stack. See [docs/dev.md](docs/dev.md) for the full guide.
- **Preflight** — `bin/iedora-env bin/iedora doctor` (PATH, BWS auth, bootstrap secrets).
- Day-2 ops (logs / psql / backup / restore / rotate / wipe) are raw SSH against the Hetzner box.

Menu image builds happen in CI (`.github/workflows/web.yml`) on every push to main: buildx (multi-arch — `linux/amd64` for CI, `linux/arm64` for the CAX Hetzner box), pushed to `ghcr.io/$GHCR_USER/web:<sha>`. The menu workflow then dispatches `deploy.yml` with `product: web` + `image_sha: <sha>`; the `dockerOnHetzner` runtime SSHs to the box, pulls the image, runs migrations, and replaces the container with a zero-downtime hot-swap. Since the menu container serves BOTH `menu.iedora.com` and `iedora.com` (host-based rewrite in `proxy.ts`), the same deploy ships both. Rollback: `gh workflow run deploy.yml --field product=web --field image_sha=<older-sha>`.

## CI

One workflow per workspace. Each is self-contained: own `paths:` trigger, own env, own job graph.

```
.github/
  actions/setup/action.yml      composite: Bun + bun install --frozen-lockfile
  workflows/
    menu.yml                     Stage 1+4: build + push menu image → dispatch deploy.yml
                                 (ships BOTH menu.iedora.com AND iedora.com — one image)
    deploy.yml                   Stage 4 reusable workflow_call (product, image_sha)
    app-state.yml                Stage 3: bin/iedora-env bin/iedora app apply (configurator registry)
    infra-deploy.yml             Stage 2: bin/iedora-env tofu -chdir=infra/iac/tofu apply
    design-system.yml            unit (jsdom)
    observability.yml            unit (no-op-in-tests + tenant attrs)
    codeql.yml                   SAST (push + PR + weekly)
    dependency-review.yml        gates PRs that add HIGH/CRITICAL CVE deps
```

**Two load-bearing decisions:**

1. **`paths:` filter per workflow** — a workflow only wakes when its workspace (or workspace deps, or root files like `bun.lock`) changes.
2. **Composite action for setup** — `actions/setup` runs `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` at the root. Every job that needs deps is `uses: ./.github/actions/setup`.

**Env:** Non-secret CI fixture literals (`DATABASE_URL`, `CORE_DATABASE_URL`, `S3_*`, `IEDORA_CORE_SECRET=test...`) live at job-level. No CI-side secrets — production auth values are TF-minted at apply time and written to BWS.

**Branch protection: deliberately off** — solo, AI-driven; CI itself is the signal.

**Dependency updates: Renovate** at `renovate.json`. Auto-merges minor/patch + security advisories after green CI. Major bumps and the auth-stack pins (Next, React, `better-auth`, `oven/bun`) are held for manual review.

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/better-auth/` — auth instance, plugins, server APIs.
3. `node_modules/drizzle-orm/` — query builder, types.
4. `products/menu/src/features/README.md` — slice inventory (16 slices, one-liner each) + anti-patterns.
5. `products/menu/src/features/<slice>/README.md` — per-slice doc (where present).
6. `packages/<package>/README.md` — every shared package documents its surface.
7. `apps/web/CLAUDE.md`, `products/<x>/CLAUDE.md`, `infra/CLAUDE.md` — scope-local rules, auto-loaded by Claude Code under that subtree.
8. `docs/agents/slice-pattern.md` — slice contract + how to add a feature. (Auto-imported.)
9. `docs/agents/cross-product-rules.md` — the 2 rules every frontend product enforces. (Auto-imported.)
10. `products/menu/tests/README.md` — test pyramid (Vitest+PGLite unit, Playwright e2e).
11. `docs/vendors.md` — every dependency with rationale.
12. `docs/deploy/README.md` — **the** infra + app-state + deploy doc. Day 0 / Day 1 / Day 2 lifecycle, stages, commands, CI, failure modes, secret rotation, backups, dev stack.
13. `infra/CLAUDE.md` § HCL style — LLM-safe HCL conventions for `infra/iac/tofu/`.
14. `docs/SECURITY.md` — security policy + vulnerability reporting.

## MCP servers (local Claude Code)

[`.mcp.json`](.mcp.json) is checked in, so every contributor's Claude
Code session loads the same servers. All `bunx`-launched except the
remote GitHub one.

| Server | Purpose | Needs |
|---|---|---|
| `shadcn` | Pull shadcn/ui component sources | — |
| `postgres` | Read-only query of the local `menu` DB | local Postgres on `:5432` |
| `bun` | Run Bun scripts/tests via MCP | — |
| `next-devtools` | Next.js 16 devtools introspection | — |
| `playwright` | Drive a browser for E2E exploration | — |
| `github` | Issues/PRs/repo over the GitHub MCP | `GITHUB_PERSONAL_ACCESS_TOKEN` env var |

Only `github` needs a credential — export `GITHUB_PERSONAL_ACCESS_TOKEN` in your shell before launching Claude Code.

The bundled docs match installed versions — trust them over recall.
