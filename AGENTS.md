<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> Bun-workspaces monorepo. One Next.js product (`products/menu/`), one
> Astro static site (`products/house/`), and two workspace packages
> (`packages/design-system/`, `packages/iedora-observability/`). `bun install` runs ONCE at the repo
> root and resolves every workspace.
>
> Paths starting with `src/...` are relative to the product directory
> the rule talks about.

## What this is

- **Menu** (menu.iedora.com — `products/menu/`) — SaaS multi-tenant restaurant menu builder. Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.
- **House** (iedora.com — `products/house/`) — umbrella brand landing page. Astro static output, deployed to Cloudflare Workers Static Assets. No DB, no auth.

**Identity is Zitadel.** Self-hosted at `auth.iedora.com` (single VPS, Tofu-managed). Menu is a thin OIDC client — no local user/session tables. The session is a single JWE cookie minted by `openid-client` + `jose` after the auth-code/PKCE dance. The identity slice calls Zitadel's management API for memberships + org provisioning via a TF-minted IAM_OWNER PAT. See `products/menu/src/features/auth/` and `products/menu/src/features/identity/`.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components).
- **TypeScript** strict, every workspace.
- **Drizzle ORM** + `postgres-js`, **Postgres 18**.
- **`openid-client` v6 + `jose` v6** — Zitadel OIDC client + cookie JWE.
- **Zitadel** v4.15.0 — self-hosted IdP (TF provider 2.12 declares org, project, OIDC app, machine user, PAT).
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives come from **`@iedora/design-system`**.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator. **Production runtime is Node** — `bun + next build` is unstable as of 2026 (oven-sh/bun#23944); `next start` runs under Node in the production container.

## Hard rules — per product

Each product's CLAUDE.md is auto-loaded under its subtree.

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 14 rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), `proxy.ts` (not middleware), money in cents, dnd-kit position columns, registry pattern for templates/languages/plans, public-menu cache by tag, beacon view tracking, vertical slice boundaries.
- **[products/house/CLAUDE.md](products/house/CLAUDE.md)** — none.

## Adding a feature (the slice pattern)

Reference: `products/menu/src/features/auth/`.

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}`.
2. **`ports.ts`** — narrow interfaces for every external effect. No Drizzle / Next types leak through.
3. **`adapters/drizzle.ts`** (`'server-only'`) — implements the port against the real world.
4. **`use-cases/<verb>.ts`** — pure-ish `(port, input) => result`. No `redirect()` / `headers()` except through the port.
5. **`index.ts`** — `React.cache()`-memoized page loaders; re-export public types. Don't export the adapter.
6. **`actions.ts`** with `'use server'` for mutations: auth guard → `runUseCase(productionAdapter, input)` → `revalidateRestaurant(slug)`. Server actions never live in `index.ts` — Next's directive doesn't traverse barrels.
7. Co-located **`<slice>.test.ts`** — `makeTestDb()` from `@/shared/testing/pglite`, real Drizzle queries, fakes only at the port boundary.
8. Short **`README.md`** at the slice root.

For asset targets, languages, plans, templates: use the matching skill (`add-asset-target`, `add-language`, `add-template`).

## File layout

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + products/{menu,house}
  justfile                               just modules: infra::, menu::, house::
  .github/                               composite setup action + one workflow per workspace
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs

  infra/                                 SHARED INFRASTRUCTURE — the single deploy entry point.
                                         Every always-on container on the Hetzner VPS is declared
                                         here as a Tofu `docker_container` resource: postgres,
                                         openobserve, zitadel + login, caddy, backups, menu_web.
    Justfile                               thin shims: deploy/destroy/doctor → bin/iedora; day-2 ops as bash
    bin/iedora, cmd/iedora/                Go orchestrator. Pass 1/2/3 dance, localhost HTTPS_PROXY for the zitadel TF provider (sidesteps macOS NXDOMAIN cache), cert-issuer probe (LE vs Caddy internal). Unit-tested.
    bin/with-secrets                       BWS wrapper. Only `BWS_ACCESS_TOKEN` required in operator's shell.
    tofu/                                Single Tofu root. Hetzner VPS + R2 buckets + DNS + GitHub
                                         Actions config + every docker_container on the box.
    backup/                              self-built Postgres-backup image

  packages/
    eslint-config/                       flat-config factories shared by every workspace
    design-system/                       editorial CSS + React primitives (paper/ink/cinnabar)
    iedora-observability/                one-line OTel wiring (traces + metrics)

  products/
    menu/                                Next.js 16 — menu.iedora.com
    house/                               Astro — iedora.com
```

Menu's `infra/` owns a Dockerfile (built by CI into the GHCR image) plus a tiny Tofu root for the R2 assets bucket and `assets.iedora.com`. The menu container itself is declared in `infra/tofu/containers.tf` at the repo root.

## Commands

### Repo-root

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — what CI uses.
- `just` — list every module's recipes.

### Per-product

- **Menu** — see [products/menu/CLAUDE.md](products/menu/CLAUDE.md) § Commands.
- **Packages** — `bun run test` / `test:watch` (Vitest; no DB for `@iedora/observability`, jsdom for `@iedora/design-system`); `bun run typecheck`.

### Deploy

- `just infra::deploy` — one `tofu apply` provisions the Hetzner VPS, every Cloudflare resource, the GH Actions config, and every container (`infra-postgres`, `infra-backups`, `infra-openobserve`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `menu_web`). Idempotent day-1 and day-N.
- `just menu::infra` — applies the menu-local Tofu (R2 assets bucket + `assets.iedora.com`). Rare.
- `just infra::logs <svc>` / `just infra::console` — tail logs / psql shell via SSH.
- `just infra::backup` / `restore` — force a Postgres dump / restore latest.
- `just infra::rotate-secret <KEY>` — prompt-driven BWS rotation; for Tofu-minted sub-tokens use `bin/with-secrets tofu -chdir=tofu apply -replace=<resource>`.
- `just infra::deploy -d` (or `--destroy`) — tears down the VPS + every Tofu-managed resource.
- `just house::deploy` / `house::destroy` — manage iedora.com via wrangler.

`just` is a Rust task runner — `brew install just` (or `cargo install just`).

Menu image builds happen in CI (`.github/workflows/menu.yml`) on every push to main: buildx for `linux/amd64` (CPX22 is x86_64), pushed to `ghcr.io/$GHCR_USER/menu:<sha>`. CI then dispatches `infra-deploy.yml` with `--field image_sha=<sha>`, which re-runs `tofu apply`; the SHA flows in as `TF_VAR_menu_image_sha`, forcing `docker_image.menu` to replace and recreating `docker_container.menu_web` in-place. Rollback = same dispatch with an older SHA.

## CI

One workflow per workspace. Each is self-contained: own `paths:` trigger, own env, own job graph.

```
.github/
  actions/setup/action.yml      composite: Bun + bun install --frozen-lockfile
  workflows/
    menu.yml                     typecheck + lint + unit + security + build/push image
    design-system.yml            unit (jsdom)
    observability.yml            unit (no-op-in-tests + tenant attrs)
    infra-deploy.yml             one tofu apply for the whole estate; workflow_run after menu.yml
    house-deploy.yml             Astro → wrangler deploy
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
6. `docs/architecture.md` — slice playbook + how to add a feature.
7. `docs/testing.md` — test pyramid (Vitest+PGLite unit, Playwright e2e).
8. `docs/security-audit.md` — threat register + supply-chain perimeter.
9. `docs/tenancy.md` — how tenancy works + the queued migrations.
10. `docs/vendors.md` — every dependency with rationale.
11. `docs/deploy.md`, `docs/secrets.md`, `docs/backups.md`, `docs/scaling.md` — ops playbooks.
12. `docs/observability.md` — OTel wiring + OpenObserve recipes.
13. `docs/infra/auth.md` — Zitadel deploy, bootstrap, day-2 ops.
14. `docs/terraform-style.md` — LLM-safe HCL conventions.
15. `docs/ai.md` — Claude Code Action + MCP servers.

The bundled docs match installed versions — trust them over recall.
