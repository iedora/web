<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Meta Menu — project conventions

## What this is
SaaS multi-tenant restaurant menu builder. Each tenant is a Better Auth `organization` that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.

## Stack
- **Next.js 16** (App Router, Turbopack default, Cache Components)
- **TypeScript** strict
- **Drizzle ORM** + `postgres-js` driver, **Postgres 18**
- **Better Auth** with `organization` plugin
- **shadcn/ui** + Tailwind v4
- **@dnd-kit** for drag-and-drop
- **Bun** as package manager and test runner; **Node** as production runtime (Bun + `next build` is unstable as of 2026 — see oven-sh/bun#23944)

## Hard rules

1. **Tenant scoping is mandatory.** Every query touching `restaurant`, `menu`, `category`, or `item` MUST filter by `restaurantId` AND verify the caller is a `member` of the parent `organization`. Never trust IDs from the client without rechecking ownership. Centralize this in `features/auth/` — use `requireRestaurantAccess(restaurantId)` before any tenant query.

2. **Schema is the source of truth.** `shared/db/schema.ts` is the single canonical schema. Migrations are generated, not handwritten — run `bun run db:generate` then `bun run db:migrate`.

3. **Auth checks belong in the data layer, not in layouts.** Layouts in Next 16 don't re-render on navigation, so an auth check in a layout WILL leak. Use `verifySession()` / `requireRestaurantAccess()` from `features/auth/` close to the data fetch or in the page component itself. The dashboard layout fetches session/plan defensively for chrome (email, Analytics link) but never redirects from there.

4. **Use shadcn via MCP** when possible. `bunx shadcn@latest add <component>` works too. Don't hand-write primitives that already exist in shadcn.

5. **No `middleware.ts`.** Next 16 renamed it to **`proxy.ts`**. The proxy is for *optimistic* redirects only (cookie presence checks). Real auth always lives in the DAL.

6. **Money is integer cents** in `priceCents`, currency in a separate column. Never use floats for prices.

7. **Drag-and-drop reordering** uses integer `position` columns (per parent). On reorder, recompute positions for affected rows in a single transaction. Renumber periodically if gaps grow.

8. **Menu templates are open/closed.** Each template lives in its own folder under `features/menu-publishing/rsc/templates/<id>/` and exports a `template: MenuTemplate` from `index.ts`. The renderer (`menu-renderer.tsx`) consumes only the registry — never edit it to support a new template. Adding a template = new folder + 1 import + 1 entry in `templates/registry.ts` + the literal in `RestaurantTheme.layout` (schema). LAYOUTS in `features/menu-publishing/rsc/theme.ts` is derived from the registry; do not maintain it separately.

9. **Asset keys are tenant-prefixed and verified twice.** Every uploaded object's S3 key starts with `r/{restaurantId}/`. The `requireRestaurantAccess` DAL guard runs first; `assertKeyBelongsToTarget` then rejects any commit whose key doesn't match the target's restaurant — defense-in-depth against a stale presign being redirected. New asset targets must follow the same `r/{restaurantId}/...` scheme in `features/upload/targets.ts` and gate item-scoped uploads with an extra ownership check (see `assertItemBelongsToRestaurant`).

10. **Languages live in a registry.** Each supported language is a self-contained module under `features/i18n/languages/<code>/` exporting `language: Language` from its `index.ts`. `features/i18n/registry.ts` is the only place that knows the full set; `LANGUAGE_CODES`, `LANGUAGE_META`, and `getLanguage` are derived. The Zod schemas in actions use `z.record(z.string(), …).refine(keys ⊂ LANGUAGE_CODES)` because Zod 4 makes `z.record(z.enum([...]), …)` exhaustive. Translatable text uses the pattern: plain `name`/`description` text columns are the source of truth for the restaurant's `defaultLanguage`; sibling jsonb `*I18n` columns carry overrides for non-default languages. Fallback chain at render time: requested → default → empty. New languages: see `/add-language` skill.

11. **Plans live in a registry.** Same shape as languages and templates: each plan is a folder under `features/plans/<code>/` exporting `plan: Plan` from `index.ts`; `features/plans/registry.ts` derives `PLAN_CODES`, `PLANS`, `getPlan`. Adding a plan = new folder + new literal in `PlanCode` union + new registry entry. Gates use `canAddRestaurant(orgId)` (returns structured `{ ok, reason, limit }` — never throws) and `planHas(plan, feature)`. The DB column `organization.plan` stores raw text; `getPlan` coerces unknown values back to the default so a renamed plan never crashes a render.

12. **Public menu is cached, invalidated by tag.** `loadRestaurantSnapshot(slug)` and `loadRestaurantAdminMenus(slug)` (use-cases in `features/menu-publishing/use-cases/`) wrap `unstable_cache` with a per-slug tag `restaurant:${slug}` via `features/menu-publishing/cache.ts`. Every mutation that affects the restaurant's public or admin view MUST call `revalidateRestaurant(slug)` (which uses `updateTag` for read-your-own-writes semantics, not `revalidateTag`). The single chokepoint is enforced — never call `revalidatePath('/r/${slug}')` from a mutation action; the cache tag is what matters. **Date gotcha:** `unstable_cache` JSON-serializes Dates to ISO strings; if a cached function returns a Date the caller will see a string. Hydrate explicitly in the loader (see `loadRestaurantAdminMenus`).

13. **View tracking is beacon-based, not server-render-coupled.** `/api/track/[slug]` is a pixel-beacon route that lives outside the cached snapshot — it runs on every public visit, even when the page itself is served from cache. Dedup is `(visitor_cookie, restaurant_id, hour_bucket)` via `view_seen.onConflictDoNothing`; only newly-inserted rows trigger `incrementDailyView`. Bot UAs filtered at the route. **Never put the view increment back inline in the page** — that breaks the moment a CDN sits in front.

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via *relative* paths; cross-slice imports MUST go through the sibling slice's `index.ts` (the single barrel) — enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`. `shared/` is for primitives with no domain knowledge (db client, env, ui primitives, testing fixtures). `app/` is delivery — routes import from slices and shouldn't carry business logic. Use-cases take their port as the first argument so the test suite wires fakes against a real PGLite database (see `features/auth/auth.test.ts`); production wires the Drizzle adapter once in the slice's `index.ts` or `actions.ts`.

## Pattern: how to add a feature

Reference template: `features/auth/`. Steps:

1. `mkdir features/<slice>/{adapters,use-cases,ui}` — `ui/` only if the slice owns React components.
2. Define **`ports.ts`** — narrow interfaces describing every effect the slice needs (db reads/writes, external APIs). One method per atomic op; no Drizzle / Next types leak through.
3. Write the production **`adapters/drizzle.ts`** (or `better-auth.ts`, `s3.ts`, …). Marked `'server-only'`. Implements the port against the real world.
4. Write **`use-cases/<verb>.ts`** as pure-ish async functions: `(port, input) => result`. No `redirect()` / `headers()` access except via the port — that's what lets Vitest run them against PGLite.
5. Expose the slice via **`index.ts`** — `React.cache()`-memoize page loaders that fan out to children. Re-export types callers need. Don't export the adapter itself.
6. If the slice has mutations, add **`actions.ts`** with `'use server'` at the top: auth guard → `runUseCase(productionAdapter, input)` → `revalidateRestaurant(slug)` (hard rule #12). Server actions don't live in `index.ts` — Next's directive doesn't traverse barrels reliably.
7. Add a co-located **`<slice>.test.ts`** next to the source — `makeTestDb()` from `@/shared/testing/pglite`, real Drizzle queries, fakes only at the port boundary.
8. Add a short **`README.md`** at the slice root documenting the public API.

For asset targets, languages, plans, templates: the registry pattern is already encoded in the matching skill (`add-asset-target`, `add-language`, `add-template`).

## File layout

The codebase is organised as **vertical slices** under `features/` (one folder
per business capability) plus **`shared/`** for cross-slice infrastructure.
Each slice follows a hexagonal-ish layout: `ports.ts` (interfaces) +
`adapters/` (Drizzle/Better Auth implementations) + `use-cases/` (pure logic)
+ `actions.ts` (server-action shells) + `ui/` (slice-owned components) +
`index.ts` (the slice's public API).

```
src/                       all Next.js source under here (Next's "src dir" convention)
  app/                     Next.js App Router routes only
    (auth)/                  public auth pages (signup, login)
    _components/             page-local components (Next-private folder)
      landing/               landing-page.tsx + landing.css (public home)
    dashboard/               admin pages — protected
      analytics/             Casa-only KPIs + scan chart; redirects free → billing
      billing/               current plan + invoice ledger (year filter)
      r/[slug]/              restaurant home
        m/[menuId]/          dnd-kit menu builder route
        theme/               settings: identity + theme editor
        qr/                  QR code generator
      layout.tsx
      page.tsx
    r/[slug]/                public menu page per restaurant — cached snapshot
    onboarding/              first-time org creation AND add-another-restaurant flow
    api/
      auth/[...all]/         Better Auth handler
      track/[slug]/          pixel-beacon view tracking endpoint (cookie dedup + bot filter)
    up/                      health-check route
    page.tsx                 landing redirect / public home
    layout.tsx
    globals.css
  features/
    auth/                    session + tenant-scoping guards
      adapters/              better-auth-instance.ts (was lib/auth.ts) + better-auth-gateway.ts
      client.ts              Better Auth React client (was lib/auth-client.ts)
      use-cases/             verifySession, requireActiveOrganization, requireRestaurantAccess, requireRestaurantBySlug
      ports.ts, index.ts
    billing/                 invoice ledger
      adapters/, use-cases/, types.ts, ports.ts, index.ts
    dashboard-home/          restaurants-with-counts aggregate query
      adapters/, use-cases/, ui/, actions.ts, ports.ts, index.ts
    i18n/                    per-language registry (en, pt, es, fr) + format helpers
      languages/             one folder per language with `language: Language` export
      registry.ts            REGISTRY + getLanguage + LANGUAGE_CODES
      format.ts, server.ts, types.ts
      ui/                    localized-fields.tsx (tabbed name+description editor)
      index.ts
    menu-builder/            dnd-kit admin builder
      adapters/drizzle.ts    MenuWritePort + MenuReadPort impls
      use-cases/             create-menu, delete-menu, seed-sample-menu, category/item CRUD, reorder, load-builder-data
      ui/                    builder.tsx + sortable-* + create-menu-dialog/delete-menu-button/seed-sample-button
      actions.ts             'use server' shells: auth guard → use-case → revalidate
      ports.ts, index.ts
    menu-publishing/         public menu cache + renderer + sample seed payload
      cache.ts               loadRestaurantSnapshot/loadRestaurantAdminMenus wrappers (unstable_cache + per-slug tag) + revalidateRestaurant
      use-cases/             load-tree, load-restaurant-snapshot, load-restaurant-admin-menus, sample-data
      rsc/                   public-render components (RSC-only)
        menu-renderer.tsx    consumes template registry; injects theme as CSS vars
        templates/
          classic/           template module: classic-menu.tsx + meta.ts + index.ts
          minimal/           template module
          registry.ts        REGISTRY + getTemplate + TEMPLATE_META
        theme.ts             ResolvedTheme defaults, FONTS; LAYOUTS derived from templates registry
        format.ts            price/i18n helpers used by templates
        types.ts             PublicMenuData / RenderProps shared by all templates
      index.ts
    metrics/                 daily-view + analytics range helpers
      adapters/, use-cases/, range.ts, types.ts, ports.ts, index.ts
    plans/                   plan registry (free, casa) — same pattern as i18n/templates
      free/index.ts          plan: Plan
      casa/index.ts          plan: Plan
      registry.ts            REGISTRY + getPlan + PLAN_CODES
      adapters/, use-cases/  canAddRestaurant, planHas, getOrganizationPlan
      actions.ts             setOrganizationPlan (Stripe-free placeholder)
      types.ts, ports.ts, index.ts
    restaurant-identity/     restaurant CRUD + theme/identity settings
      adapters/, use-cases/, ui/, actions.ts, ports.ts, index.ts
    upload/                  S3-compatible uploads + presign/commit/clear
      adapters/              s3-storage.ts (AWS SDK v3) + bootstrap.ts (ensureBucket/CORS)
      targets.ts             constraints + tenant-prefixed key builder
      use-cases/             presign + commit + clear
      actions.ts             DAL-guarded server actions
      ui/                    image-upload.tsx generic <ImageUpload target=...>
      types.ts, index.ts
  shared/                    cross-slice infrastructure
    db/
      client.ts              drizzle client
      schema.ts              all tables — single source of truth
    env.ts                   validated environment variables
    ui/                      shadcn primitives + editorial-list (cross-slice generic UI)
      editorial-list/        EditorialList + EditorialRow + StatusPill + ActionChip
      button.tsx, card.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx, label.tsx, separator.tsx, textarea.tsx
    utils.ts                 shadcn cn() helper
    testing/                 shared test fixtures
  proxy.ts                 Next 16 proxy (was middleware) — at src/ root (App Router convention)
  i18n/                    next-intl request config + message catalogues
next.config.ts             Next-required root file
drizzle.config.ts          schema path → ./src/shared/db/schema.ts
tsconfig.json              "@/*": ["./src/*"]
docker-compose.yml         postgres + redis + localstack
.env.example               dev template — copy to .env.local (Next.js dev)
infra/                     ALL infra lives here — Make forwarder at root delegates `make X` → `make -C infra X`
  Dockerfile               app build (multi-stage Bun-install + Node-build + standalone)
  Makefile                 deploy/destroy/rotate/logs/etc. targets; loads infra/.env
  .env.example             infra template — copy to infra/.env (gitignored, NOT loaded by Next, so creds never reach process.env)
  tofu/                    Cloudflare tunnel + DNS + ingress + R2 bucket (state encrypted, public_hostname from TF_VAR_)
  kamal/
    config/deploy.yml      Kamal 2 deploy config — app + 4 accessories (postgres, redis, minio, cloudflared)
    .kamal/secrets         shell-evaluated references: TUNNEL_TOKEN from tofu, KAMAL_REGISTRY_PASSWORD from `gh auth token`, rest from infra/.env
  backup/                  self-built Postgres-backup image (Dockerfile + bash); built via `make build-backup`
scripts/
  migrate.mjs              Drizzle migrations under pg_advisory_lock
  check-migrations.ts      dev-time guardrail; warns when journal has pending migrations
.github/workflows/
  ci.yml                   Typecheck + Lint + E2E (Playwright); Bun for installs, Node for build
.mcp.json                  shadcn, postgres, bun, next-devtools, playwright MCP servers
eslint.config.mjs          enforces no cross-slice imports via eslint-plugin-boundaries (slices may only import shared/* or their own siblings via barrels)
tests/e2e/
  fixtures.ts              auto-fixture: fails fast on any RSC error / 5xx response
  specs/                   organized by module: auth, tenancy, menu-builder, public-menu,
                           settings, qr, uploads, plans, billing, metrics, dashboard, landing
  helpers/                 shared signup/org/db utilities
```

## Useful commands
- `bun run dev` — Next.js dev server (Turbopack). Also warns at startup when migrations are pending.
- `bun run typecheck` — TS check without emit
- `bun run lint` — ESLint (boundary rules included)
- `bun run test` / `bun run test:watch` — Vitest unit suite (PGLite, co-located `*.test.ts`)
- `bun run test:e2e` / `:ui` / `:debug` — Playwright suite (production build + start)
- `bun run db:generate` — generate Drizzle migration from `shared/db/schema.ts`
- `bun run db:migrate` — apply pending migrations
- `bun run db:push` — push schema directly (dev only, no migration files)
- `bun run db:studio` — open Drizzle Studio
- `bun run auth:generate` — sync Better Auth tables into `shared/db/schema.ts` (re-run after changing auth plugins)
- `docker compose up -d` — start Postgres + Redis + LocalStack (S3)
- `bunx shadcn@latest add <name>` — add a shadcn component
- `cp infra/.env.example infra/.env` — infra config (gitignored, NOT loaded by Next.js). Fill in 7 user inputs + 4 hand-generated secrets (`openssl rand -hex 32`). The matching `.env.local` (for Next dev) is separate so Cloudflare/R2 creds never reach Next's `process.env`.
- **First-time setup** (once, manual): `ssh-copy-id root@$ONPREM_HOST` (Kamal's canonical SSH user — root with key-only login); `gh auth refresh -s write:packages`; then `make deploy`. See `docs/deploy.md` for the homelab key-copy step when root SSH isn't already enabled.
- `make deploy` — single command, idempotent. Internally: `tofu apply` + `kamal setup` (= server bootstrap + accessory boot all + deploy). ~10s overhead on subsequent runs from the no-op idempotence checks; acceptable for not having to remember a separate first-time command.
- `make logs` / `make console` / `make redeploy` / `make rollback` / `make migrate` — direct `kamal` calls with infra/.env loaded via `-include`.
- `make destroy` — `tofu destroy`: removes Cloudflare tunnel + DNS only (does not touch the box)
- `make help` — list every target

Build + push lives on the homelab box itself (`builder.remote: ssh://root@$ONPREM_HOST`, native amd64). Image is pushed to **GHCR** (`ghcr.io/$GHCR_USER/meta-menu`); auth is `gh auth token` evaluated from `.kamal/secrets`. No local registry, no buildx insecure-registry config, no daemon.json mutation.

## CI
`.github/workflows/ci.yml` runs three jobs on every push and PR:
- **Typecheck** and **Lint** in parallel (Bun runtime).
- **E2E (Playwright)** with Postgres 18, Redis 7, and LocalStack as service containers. Build runs under Node (`node --run build`) because Bun + `next build` is unstable. Caches `.next/cache` and `~/.cache/ms-playwright`.

Branch protection: deliberately NOT enabled — solo, AI-driven project; the CI itself is the signal. Revisit when adding collaborators or after the first "broken main" incident.

## Where to look when unsure
1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs
2. `node_modules/better-auth/` and the Better Auth README in node_modules — auth APIs
3. `node_modules/drizzle-orm/` — query builder, types
4. `features/<slice>/README.md` — every slice has a short doc describing its public API
5. `docs/architecture.md` — the slice playbook (what goes where + how to add a feature)
6. `docs/testing.md` — the test pyramid (Vitest+PGLite unit; Playwright e2e)

The bundled docs match installed versions — trust them over recall.
