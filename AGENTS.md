<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> Bun-workspaces monorepo. One Next.js product (`products/menu/`)
> serving both `menu.iedora.com` (menu app) and `iedora.com` (house
> landing) through a Host-based rewrite in `src/proxy.ts`, plus two
> workspace packages (`packages/design-system/`,
> `packages/iedora-observability/`). `bun install` runs ONCE at the repo
> root and resolves every workspace.
>
> Paths starting with `src/...` are relative to the product directory
> the rule talks about.

## What this is

- **Menu** (menu.iedora.com — `products/menu/`) — SaaS multi-tenant restaurant menu builder. Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.
- **House** (iedora.com — `products/menu/src/app/house/`) — brand landing page. Lives inside the menu Next.js app; `src/proxy.ts` inspects Host and rewrites apex requests under `/house/*` internally. One container, one image, two hostnames.

**Identity is Zitadel.** Self-hosted at `auth.iedora.com` (single VPS, Tofu-managed). Menu is a thin OIDC client. The `menu_session_v2` cookie is a JWE carrying only `{sid, sub, exp}`; the authoritative state is a server-side `menu.session` row (roles, permissions, permissionsVersion) so Zitadel Actions v2 webhooks can rewrite scopes live without waiting for cookie TTL. See `products/menu/src/features/auth/README.md` for the revocation model. The identity slice calls Zitadel's management API for memberships + org provisioning via a PAT minted by `bin/zitadel-apply` (Stage 3) and written to BWS. See `products/menu/src/features/auth/` and `products/menu/src/features/identity/`.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components).
- **TypeScript** strict, every workspace.
- **Drizzle ORM** + `postgres-js`, **Postgres 18**.
- **`openid-client` v6 + `jose` v6** — Zitadel OIDC client + cookie JWE.
- **Zitadel** v4.15.0 — self-hosted IdP. The CONTAINER is part of the compose stack rendered by Tofu (`infra/iac/tofu/compose.tf::local.compose.services.zitadel`); the box runs it via the `iedora.service` systemd unit. The APP STATE (org, project, OIDC app, action targets, PAT) is reconciled by `bin/zitadel-apply` (Stage 3 of the pipeline), via Zitadel's REST API.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives come from **`@iedora/design-system`**.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator. **Production runtime is Node** — `bun + next build` is unstable as of 2026 (oven-sh/bun#23944); `next start` runs under Node in the production container.

## Hard rules — cross-product

Cross-product rules live in [`docs/agents/cross-product-rules.md`](docs/agents/cross-product-rules.md) and are auto-included below. Two rules today: `data-test-id` on interactive components + visible UI text via translation.

@docs/agents/cross-product-rules.md

## Hard rules — per product

Each product's CLAUDE.md is auto-loaded under its subtree.

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 16 rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), `proxy.ts` (not middleware — and now also handles Host-based rewrite for iedora.com → `/house/*`), money in cents, dnd-kit position columns, registry pattern for templates/languages/plans, public-menu cache by tag, beacon view tracking, vertical slice boundaries, co-located E2E + testing surface per slice, **redirects via `publicUrl()`**.
- **House** (iedora.com) lives at `products/menu/src/app/house/` — no separate CLAUDE.md; same cross-product rules apply.

## Slice pattern

The slice contract (file layout, cross-slice rules, the Next.js boundary, how to add a feature) lives in [`docs/agents/slice-pattern.md`](docs/agents/slice-pattern.md) and is auto-included below.

@docs/agents/slice-pattern.md

## File layout

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + products/menu
  go.mod, go.sum                         single Go module rooted at the repo root
  .github/                               composite setup action + one workflow per pipeline stage
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs

  bin/                                   Shim entry points — `go run` / `bash` wrappers operators invoke
    iedora-env                              Env-hydration helper (BWS → TF_VAR_*/AWS_*/CLOUDFLARE_ACCOUNT_ID)
    iedora                                  Stage 3 + Stage 4 orchestrator (app apply, deploy <prod>, doctor)
    state-bucket-bootstrap                  Stage -1 — provisions R2 bucket + token for Tofu's s3 backend
    bws-sync                                Batched Tofu BWS write/delete (single sequential pass)
    bws-upsert                              Single-key BWS upsert/delete (ad-hoc, operator scripts)
    zitadel-apply                           Stage 3 — Zitadel app config (org / project / OIDC / PAT)
    menu-db-migrations                      Stage 3 — drizzle-kit migrate on menu's postgres DB
    openobserve-dashboards                  Stage 3 — push dashboard JSONs via SSH-L tunnel

  infra/                                 Pipeline stages — one folder per stage, nothing else.
                                         See infra/CLAUDE.md for the deep dive.
    iac/                                   Stage 2 — IaC for the shared estate
      tofu/                                  Encrypted Tofu root (VPS + CF + GH config + rendered
                                             docker-compose stack). Plain `tofu apply` — no wrappers.
                                             Files: compose.tf, sync.tf, destroy-hooks.tf,
                                             hetzner.tf, templates/{Caddyfile,cloud-init.yml}.
                                             Menu container = Stage 4, NOT here.
      postgres/init.sql                      CREATE DATABASE menu / zitadel (compose volume init)
      cmd/
        bws-sync/                            Go helper for terraform_data.bws_sync (batched)
        bws-upsert/                          Single-key variant (ad-hoc, BWS_DELETE=1 supported)
        infra-pg-backup/                     Backup container (Go + Dockerfile, arm64 only — CAX SKUs)
        state-bucket-bootstrap/              Stage -1 — R2 bucket + token bootstrap (chicken/egg)
    app-state/                             Stage 3 — configurators (one per concern)
      cmd/
        zitadel-apply/                       Zitadel REST reconciler
        menu-db-migrations/                  drizzle-kit migrate runner (SSH + docker run)
        openobserve-dashboards/              dashboard reconciler (SSH-L tunnel + go:embed JSONs)
    deploy/                                Stage 3 + Stage 4 router
      cmd/
        iedora/                              Configurator registry + productRuntime registry

  dev/                                   Local stack (mirror of all 4 stages, local Docker).
                                         Top-level peer of infra/ because it's not a stage —
                                         it's the offline twin used for local dev.
    docker-compose.yml                     Postgres + Zitadel + OpenObserve + LocalStack
    localstack-init.sh                     Seeds LocalStack's R2 buckets on first boot
    cmd/local-stack/                       Driver: compose up → zitadel-apply --mode local → menu .env
    .zitadel-bootstrap/                    (gitignored) local Zitadel FirstInstance outputs

  internal/                              Shared Go libs (bws, cloudflare, mode, r2, ssh,
                                         testfakes, tlsprobe). Top-level so Go's `internal/`
                                         visibility scopes them to the whole module — every
                                         stage's cmd can import.

  packages/
    eslint-config/                       flat-config factories shared by every workspace
    design-system/                       editorial CSS + React primitives (paper/ink/cinnabar)
    iedora-observability/                one-line OTel wiring (traces + metrics)

  products/
    menu/                                Next.js 16 — serves BOTH menu.iedora.com and iedora.com
      src/proxy.ts                         Host-based rewrite: iedora.com/* → /house/*
      src/app/house/                       Brand landing for iedora.com
```

Menu's container is NOT in the compose stack rendered by `infra/iac/tofu/compose.tf` — only the shared services (postgres, zitadel, caddy, openobserve, backups) live there. Menu's lifecycle (pull/run on every deploy) is owned by Stage 4 via [`infra/deploy/cmd/iedora/runtime_docker.go`](infra/deploy/cmd/iedora/runtime_docker.go); Caddy routes both `menu.iedora.com` and `iedora.com` (apex + www) to the same network alias so one container serves both sites.

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

- **Stage 2** — plain Tofu. `init` / `plan` / `apply` / `destroy` against `infra/iac/tofu/`. The Tofu graph renders a docker-compose document (`compose.tf`) + Caddyfile; cloud-init drops them on first boot, `terraform_data.iedora_sync` pushes day-2 changes via one SSH session. `rclone` is required on the operator's machine — destroy-time hooks (`destroy-hooks.tf`) purge R2 buckets before the API DELETE.
- **Stage 3** — `bin/iedora app apply` runs every configurator in `configurators.go` sequentially: zitadel-apply, menu-db-migrations, openobserve-dashboards.
- **Stage 4** — `bin/iedora deploy <product>` (or `destroy <product>`). Dispatches through the productRuntime registry (`products.go`).
- **Local dev** — `go run ./dev/cmd/local-stack` boots the local-twin stack. `--destroy` wipes it; `--reset-db <service>` drops + recreates one database.
- **Preflight** — `bin/iedora-env bin/iedora doctor` (PATH, BWS auth, bootstrap secrets).
- Day-2 ops (logs / psql / backup / restore / rotate / wipe / zitadel-rebootstrap) are raw SSH against the Hetzner box.

Menu image builds happen in CI (`.github/workflows/menu.yml`) on every push to main: buildx (multi-arch — `linux/amd64` for CI, `linux/arm64` for the CAX Hetzner box), pushed to `ghcr.io/$GHCR_USER/menu:<sha>`. The menu workflow then dispatches `deploy.yml` with `product: menu` + `image_sha: <sha>`; the `dockerOnHetzner` runtime SSHs to the box, pulls the image, runs migrations, and replaces the container with a zero-downtime hot-swap. Since the menu container serves BOTH `menu.iedora.com` and `iedora.com` (host-based rewrite in `proxy.ts`), the same deploy ships both. Rollback: `gh workflow run deploy.yml --field product=menu --field image_sha=<older-sha>`.

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
    scorecard.yml                OpenSSF posture grading (weekly)
    dependency-review.yml        gates PRs that add HIGH/CRITICAL CVE deps
```

**Two load-bearing decisions:**

1. **`paths:` filter per workflow** — a workflow only wakes when its workspace (or workspace deps, or root files like `bun.lock`) changes.
2. **Composite action for setup** — `actions/setup` runs `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` at the root. Every job that needs deps is `uses: ./.github/actions/setup`.

**Env:** Non-secret CI fixture literals (`DATABASE_URL`, `S3_*`, `MENU_SESSION_SECRET=test...`, `ZITADEL_*=test`) live at job-level. No CI-side secrets — auth/OIDC values are TF-minted at apply time.

**Branch protection: deliberately off** — solo, AI-driven; CI itself is the signal.

**Dependency updates: Renovate** at `renovate.json`. Auto-merges minor/patch + security advisories after green CI. Major bumps and the auth-stack pins (Next, React, `openid-client`, `jose`, Zitadel image, `oven/bun`) are held for manual review.

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/openid-client/` and `node_modules/jose/` — OIDC + JWE APIs.
3. `node_modules/drizzle-orm/` — query builder, types.
4. `products/menu/src/features/<slice>/README.md` — every slice has a short doc.
5. `packages/<package>/README.md` — every shared package documents its surface.
6. `docs/agents/slice-pattern.md` — slice contract + how to add a feature. (Auto-imported.)
7. `docs/agents/cross-product-rules.md` — the 2 rules every frontend product enforces. (Auto-imported.)
8. `docs/architecture.md` — monorepo overview + menu's slice inventory + anti-patterns.
9. `docs/testing.md` — test pyramid (Vitest+PGLite unit, Playwright e2e).
10. `docs/security-audit.md` — threat register + supply-chain perimeter.
11. `docs/tenancy.md` — how tenancy works + the queued migrations.
12. `docs/vendors.md` — every dependency with rationale.
13. `docs/deploy.md` — **the** infra + app-state + deploy doc. Stages, commands, CI, failure modes, secret rotation, bootstrap, day-2 ops, Zitadel rebootstrap, backups, dev stack. One doc for everything pipeline-shaped.
14. `docs/terraform-style.md` — LLM-safe HCL conventions.
15. `docs/ai.md` — Claude Code Action + MCP servers.

The bundled docs match installed versions — trust them over recall.
