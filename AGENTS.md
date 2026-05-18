<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> This is a **Bun-workspaces monorepo**. Two Next.js products
> (`products/menu/`, `products/genkan/`), one Astro static site
> (`products/house/`), and three workspace packages
> (`packages/design-system/`, `packages/iedora-identity/`,
> `packages/iedora-auth-testkit/`). `bun install` runs ONCE at the repo
> root and resolves every workspace; you almost never `cd` to install.
>
> Most hard rules below come in two parts — a "Menu" set (the rules
> that have been here since the menu app started) and a "Genkan" set
> (the IdP's load-bearing constraints). Paths starting with `src/...`
> are relative to whichever product directory the rule talks about.
> The house product is a static landing page; it has no code-level
> conventions beyond `products/house/README.md`.

## What this is

**iedora** is the umbrella. Two products federate through it:

- **Menu** (menu.iedora.com — `products/menu/`) — a SaaS multi-tenant
  restaurant menu builder. Each tenant is an organization that owns
  one or more `restaurant` rows. Admins build menus via drag-and-drop;
  the public menu renders from the same data. Menu owns ZERO
  organization data of its own — every organization read/write goes
  over HTTP to genkan via `src/features/identity/`.
- **Genkan** (genkan.iedora.com — `products/genkan/`) — the iedora
  IdP. Better Auth + `@better-auth/oauth-provider` + the
  `organization` and `admin` plugins. Owns the canonical user,
  session, organization, membership, OAuth-client, audit-log and
  webhook-subscription tables. Every other product authenticates
  through genkan via OIDC; every product receives identity events
  via signed webhooks. "Genkan" is Japanese for the entryway of a
  house — the room you pass through to get inside.
- **House** (iedora.com — `products/house/`) — the umbrella brand
  landing page. Astro static output, deployed to Cloudflare Workers
  Static Assets. Deliberately small. No DB, no auth.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components) — both products.
- **TypeScript** strict — every workspace.
- **Drizzle ORM** + `postgres-js` driver, **Postgres 18**.
- **Better Auth 1.6.11** — pinned exact across the repo. Menu uses
  the core plus the bundled `organization` plugin (federated to
  genkan); genkan also runs **`@better-auth/oauth-provider`
  1.6.11**, plus the `admin` and `organization` plugins, plus the
  built-in `jwt` plugin for OIDC.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives
  (Wordmark, Card, Dialog, …) come from
  **`@iedora/design-system`** for ALL three products.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator.
  `bun install` at the repo root resolves every workspace; the
  workspace lockfile is `bun.lock`. **Production runtime is
  Node** — `bun + next build` is unstable as of 2026
  (oven-sh/bun#23944), and `next start` runs under Node in Kamal.
- **`@iedora/auth-testkit`** — workspace fixture that boots a real
  Better Auth + OAuth-provider against PGLite for integration tests
  in any product that consumes genkan. See `docs/testing.md` for the
  full walkthrough.

## Hard rules — per product

Each product owns its own CLAUDE.md with its product-specific hard rules. Claude Code auto-loads the relevant one when you work under that subtree, keeping context lean.

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 14 menu-specific rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), no middleware.ts (it's `proxy.ts` in Next 16), money in cents, dnd-kit position columns, open/closed template + language + plan registries, public-menu cache invalidation by tag, beacon-based view tracking, vertical slice boundaries.
- **[products/genkan/CLAUDE.md](products/genkan/CLAUDE.md)** — 7 genkan-specific rules: two-tier admin auth, audit chain Postgres-advisory-lock integrity, JWKS rotation cron, reauth gate for destructive actions, webhook-secret AES-GCM encryption, impersonation audit ordering, telemetry off.
- **[products/house/CLAUDE.md](products/house/CLAUDE.md)** — deliberately no code-level rules (static Astro on Workers Static Assets).

Genkan reuses menu's slice rules (menu's rules 2, 3, 5, 14 are cross-cutting) — read both when working across the federation boundary.

## Pattern: how to add a feature

Reference templates: `src/features/auth/` in either product.
`src/features/audit/` in genkan is a slightly larger example
(adapter + chain library + verifier + use-cases + tests).
The shape is the same in menu and genkan:

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}` — `ui/` only if the slice owns React components.
2. Define **`ports.ts`** — narrow interfaces describing every effect the slice needs (db reads/writes, external APIs). One method per atomic op; no Drizzle / Next types leak through.
3. Write the production **`adapters/drizzle.ts`** (or `better-auth.ts`, `s3.ts`, `genkan-http.ts`, …). Marked `'server-only'`. Implements the port against the real world.
4. Write **`use-cases/<verb>.ts`** as pure-ish async functions: `(port, input) => result`. No `redirect()` / `headers()` access except via the port — that's what lets Vitest run them against PGLite.
5. Expose the slice via **`index.ts`** — `React.cache()`-memoize page loaders that fan out to children. Re-export types callers need. Don't export the adapter itself.
6. If the slice has mutations, add **`actions.ts`** with `'use server'` at the top: auth guard → `runUseCase(productionAdapter, input)` → `revalidateRestaurant(slug)` (menu) / `revalidatePath(...)` (genkan; no cached snapshot to invalidate by tag). Server actions don't live in `index.ts` — Next's directive doesn't traverse barrels reliably.
7. Add a co-located **`<slice>.test.ts`** (menu) or **`__tests__/<verb>.test.ts`** (genkan) next to the source — `makeTestDb()` from `@/shared/testing/pglite`, real Drizzle queries, fakes only at the port boundary. If you need a real OIDC handshake, reach for `@iedora/auth-testkit`'s `startTestGenkan()`.
8. Add a short **`README.md`** at the slice root documenting the public API.

For asset targets, languages, plans, templates: the registry
pattern is already encoded in the matching skill
(`add-asset-target`, `add-language`, `add-template`).

## File layout

The repo is a Bun workspace: `bun.lock` at the root, every
workspace under `packages/*` or `products/*`. Sibling products
never share files — anything that looked shared (BWS credentials,
the Cloudflare zone) gets duplicated per product so each one is
independently appliable.

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + products/{menu,genkan,house}
  justfile                               just modules: infra::, menu::, genkan::, house::
  .github/                               composite setup action + one workflow per workspace
    actions/setup/action.yml             composite: install Bun + bun install --frozen-lockfile
    workflows/menu.yml                   menu's full pipeline (typecheck + lint + unit + e2e)
    workflows/genkan.yml                 genkan's pipeline (typecheck + unit)
    workflows/design-system.yml          @iedora/design-system unit suite
    workflows/identity.yml               @iedora/identity unit suite
    workflows/auth-testkit.yml           @iedora/auth-testkit unit suite
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs (deploy, scaling, backups, secrets,
                                         security-audit, tenancy, vendors, architecture, testing)

  infra/                                 SHARED INFRASTRUCTURE — applied BEFORE any product.
                                         Postgres accessory + daily backups accessory live here
                                         because both products use them. Container names are
                                         `infra-postgres` and `infra-backups`.
    justfile                             deploy / backup / restore / wipe-postgres / build-backup
    .env.example                         infra template (BWS token + ONPREM_HOST + GHCR_USER + CF acct)
    bin/with-secrets                     BWS wrapper; only TF_VAR_account_id + cloudflare_api_token + state_passphrase
    tofu/                                ONE resource set: `iedora-backups` R2 bucket + its scoped R2 token
    kamal/                               Kamal 2 — accessory-only (`kamal accessory boot all`, never `kamal deploy`)
    backup/                              self-built Postgres-backup image (Dockerfile + backup.sh + restore.sh + run.sh)

  packages/
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
        receiver.ts                      verify + dedup + handler dispatch
        ssrf.ts                          DNS-resolve + private-CIDR reject (rebind gap noted)
        secret-storage.ts                AES-256-GCM HKDF cipher used for stored webhook secrets
        __tests__/                       crypto + parsing unit tests (no DB)
      README.md                          surface + security model
    iedora-auth-testkit/                 @iedora/auth-testkit — in-process Better Auth + PGLite
      src/
        index.ts                         startTestGenkan + signTestToken
        start-test-genkan.ts             boots node:http, wires Better Auth, applies migrations
        schema.ts                        re-export of genkan's schema (subpath: ./schema)
        push-schema.ts                   drizzle migrations runner against PGLite
        seed.ts                          {user,organization,member,grant} convenience seeders
        sign-test-token.ts               mint a JWT signed by the test instance's JWKS
        __tests__/                       smoke + handshake + seed sanity tests
      README.md                          worked example + API table

  products/
    menu/                                Next.js 16 — menu.iedora.com (SaaS menu builder)
                                         → full subtree in products/menu/CLAUDE.md
    genkan/                              Next.js 16 — genkan.iedora.com (iedora IdP)
                                         → full subtree in products/genkan/CLAUDE.md
    house/                               Astro — iedora.com (brand site, static)
                                         → see products/house/CLAUDE.md + README.md
```

Each product's `infra/` mirrors a common shape: `Dockerfile` (Next products), `justfile` (deploy/destroy/rotate-secret recipes), `.env.example`, `bin/with-secrets` (BWS wrapper), `tofu/` (encrypted Cloudflare state), `kamal/` (Kamal 2 config + secrets).

## Useful commands

`bun install` runs ONCE at the repo root. The workspace lockfile
covers every package and product; you almost never need to install
inside a sub-package. Dev/test/build scripts run inside the product
or package directory.

### Repo-root commands

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — what CI uses; matches `bun.lock` exactly.
- `just` — list every product module + its recipes.
- `just menu` / `just genkan` / `just house` — list one product's recipes.

### Per-product commands

- **Menu** — see [products/menu/CLAUDE.md](products/menu/CLAUDE.md) § Commands.
- **Genkan** — see [products/genkan/CLAUDE.md](products/genkan/CLAUDE.md) § Commands. (Genkan runs on **port 3001**; menu on 3000.)
- **Packages** (`packages/<name>/`) — `bun run test` / `test:watch` (Vitest; no DB for `@iedora/identity`, PGLite for `@iedora/auth-testkit`, jsdom for `@iedora/design-system`); `bun run typecheck`.

### Deploy (`just <product>::<recipe>` at repo root)

- **First-time setup** (once, manual): `ssh-copy-id root@$ONPREM_HOST` (Kamal's canonical SSH user — root with key-only login); `gh auth refresh -s write:packages`; then `just infra::deploy` (shared Postgres + backups), then `just menu::deploy`, then `just genkan::deploy`. See `docs/deploy.md` for the homelab key-copy step when root SSH isn't already enabled.
- `just infra::deploy` — shared infra: provisions the `iedora-backups` R2 bucket via Tofu, then boots `infra-postgres` + `infra-backups` accessories via Kamal. MUST run before any product deploy.
- `just menu::deploy` — menu app: tofu apply (tunnel + DNS + assets R2) + kamal setup/deploy, idempotent. The recipe probes for an existing kamal-proxy container and chooses `setup` vs `deploy` accordingly.
- `just genkan::deploy` — same shape; connects to the shared `infra-postgres` accessory (separate logical database: `genkan`).
- `just menu::logs` / `console` / `rollback` and `just genkan::logs` / `console` / `rollback` — direct `kamal` calls; each product's `.env` is auto-loaded via `set dotenv-load`. (Migrations run on container start via the Kamal `cmd:` — no separate `migrate` recipe needed.)
- `just infra::backup` / `restore` — force a Postgres dump now / restore latest (interactive). The infra workspace owns the shared Postgres accessory + the backups accessory; backups are cluster-wide (`pg_dumpall`) and cover every product's database.
- `just infra::build-backup` — rebuild the backup accessory image (only needed when bumping the Postgres major).
- `just menu::rotate-secret <KEY>` / `just genkan::rotate-secret <KEY>` — rotate one BWS secret (prompts new value, edits BWS, reminds to redeploy). For sub-tokens (R2, tunnel): `cd products/<name>/infra && bin/with-secrets tofu -chdir=tofu apply -replace=<resource>`. See `docs/secrets.md`.
- `just menu::destroy` / `just genkan::destroy` — `tofu destroy` for that product: removes its Cloudflare tunnel + DNS (does NOT touch the box, does NOT touch the other product).
- `just house::deploy` / `house::destroy` — manage iedora.com (Astro build → workload-token refresh → `wrangler deploy` uploading dist/ + apex `custom_domain` route). `just house::build` / `house::preview` for local-only checks.

`just` itself is a Rust task runner — `brew install just` on macOS,
`cargo install just` on the homelab. Replaces the old root + infra
Makefiles.

Build + push lives on the homelab box itself
(`builder.remote: ssh://root@$ONPREM_HOST`, native amd64). Images
are pushed to **GHCR** (`ghcr.io/$GHCR_USER/menu` for menu,
`ghcr.io/$GHCR_USER/genkan` for genkan); auth is `gh auth token`
evaluated from each product's `kamal/.kamal/secrets`. No local
registry, no buildx insecure-registry config, no daemon.json
mutation.

## CI

**One workflow file per workspace** — every product and every shared
package owns its own `.github/workflows/<name>.yml`. Each file is
self-contained: own trigger paths, own env block, own job graph.
Adding a new workspace = one new file.

```
.github/
  actions/setup/action.yml      composite: install Bun + bun install --frozen-lockfile
  workflows/
    menu.yml                     menu's full pipeline (typecheck, lint, unit, e2e)
    genkan.yml                   genkan's pipeline (typecheck, unit)
    design-system.yml            @iedora/design-system unit suite
    identity.yml                 @iedora/identity unit suite
    auth-testkit.yml             @iedora/auth-testkit unit suite
```

**Two load-bearing decisions:**

1. **`paths:` trigger filter per workflow.** Each workflow's `on:`
   block lists the workspaces that should retrigger it. Menu lists
   `products/menu/**` plus its workspace deps (`design-system`,
   `identity`, `auth-testkit`) plus root files (`bun.lock`,
   `package.json`, `tsconfig*.json`, its own workflow file, the
   composite action). A change in genkan source DOES NOT wake menu's
   pipeline — they're truly independent.

2. **Composite action for setup.** `actions/setup` runs
   `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` at the
   repo root. Every job that needs deps is one line:
   `uses: ./.github/actions/setup`. Bumping Bun or adding a cache
   layer is a one-file edit, applies to all workflows.

**The jobs (per file):**

- **menu.yml** — `typecheck`, `lint`, `unit` (parallel), then `e2e`
  with `needs: [typecheck, lint, unit]`. The e2e job owns the entire
  env block (Postgres + LocalStack services, GENKAN_* / S3_* /
  DATABASE_URL literals) — they're all menu-specific.
- **genkan.yml** — `typecheck`, `unit` (parallel). No e2e suite
  (see `docs/testing.md` "Why genkan has no Playwright suite").
- **design-system.yml** — `unit` (jsdom-backed Vitest).
- **identity.yml** — `unit` (pure crypto + parsing).
- **auth-testkit.yml** — `unit` (boots real Better Auth + PGLite,
  walks the OIDC handshake). Re-exports genkan's schema, so its
  `paths:` filter ALSO includes `products/genkan/src/shared/db/schema.ts`
  — a genkan schema change retriggers it.

**Where env lives:**

- **Job-level (`env:` in menu.yml's e2e job)** — every CI fixture
  literal: `DATABASE_URL`, `GENKAN_*`, `NEXT_PUBLIC_GENKAN_URL`,
  `S3_*`. These aren't secret — they live in code, not in GH Secrets.
- **GH Secrets** — only `BETTER_AUTH_SECRET` (truly sensitive). When
  deploy workflows land, true per-environment secrets graduate to
  **GitHub Environments** (`environment: production` / `staging`).

**Branch protection: deliberately NOT enabled** — solo, AI-driven
project; CI itself is the signal. This also dodges the well-known
gotcha where `paths:`-filtered workflows leave required status
checks "expected" indefinitely on unrelated PRs. Revisit when
adding collaborators.

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/better-auth/` and the Better Auth README in node_modules — auth APIs (1.6.11 pinned across the repo).
3. `node_modules/@better-auth/oauth-provider/` — the OAuth-provider plugin docs that genkan loads.
4. `node_modules/drizzle-orm/` — query builder, types.
5. `products/<product>/src/features/<slice>/README.md` — every slice has a short doc describing its public API.
6. `packages/<package>/README.md` — every shared package documents its surface.
7. `docs/architecture.md` — the slice playbook (what goes where + how to add a feature).
8. `docs/testing.md` — the test pyramid (Vitest+PGLite unit; auth-testkit integration; Playwright e2e).
9. `docs/security-audit.md` — the security model + audited surface.
10. `docs/tenancy.md` — how tenancy works across the federation boundary.
11. `docs/vendors.md` — every paid + free dependency with rationale.
12. `docs/deploy.md`, `docs/secrets.md`, `docs/backups.md`, `docs/scaling.md` — ops playbooks (apply across products).
13. `docs/terraform-style.md` — 10-bullet LLM-safe HCL conventions for every Tofu root + shared module in the repo. Apply before editing any `.tf`.
14. `docs/infra-declarative-roadmap.md` — what's declarative today vs. what's queued for migration; rationale for tiered priorities.

The bundled docs match installed versions — trust them over recall.
