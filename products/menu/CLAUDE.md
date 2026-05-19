# Menu — `products/menu/`

Menu-specific hard rules, file layout, and commands. The root `AGENTS.md` covers cross-cutting conventions (stack, slice pattern, CI, repo-root commands). Claude Code auto-loads both when working under this subtree.

Menu is a SaaS multi-tenant restaurant menu builder (menu.iedora.com). Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.

> **Identity status (2026-05-19).** The original genkan IdP has
> been deleted. Identity is moving to Zitadel (`auth.iedora.com` —
> issue #19 Phase 3+). Until that cuts over, `src/features/identity/`
> still references the old genkan-http adapter and is effectively
> dead code; the Zitadel adapter is pending.

## Hard rules — Menu

Paths starting with `src/...` are menu-relative.

1. **Tenant scoping is mandatory.** Every query touching `restaurant`, `menu`, `category`, or `item` MUST filter by `restaurantId` AND verify the caller is a member of the parent organization. Never trust IDs from the client without rechecking ownership. Centralize this in `src/features/auth/` — use `requireRestaurantAccess(restaurantId)` before any tenant query. Organization membership currently routes through `src/features/identity/` (HTTP to genkan, now dead code — see issue #19 Phase 3+ for the Zitadel adapter).

2. **Schema is the source of truth.** `src/shared/db/schema.ts` is the single canonical schema. Migrations are generated, not handwritten — run `bun run db:generate` then `bun run db:migrate`.

3. **Auth checks belong in the data layer, not in layouts.** Layouts in Next 16 don't re-render on navigation, so an auth check in a layout WILL leak. Use `verifySession()` / `requireRestaurantAccess()` from `src/features/auth/` close to the data fetch or in the page component itself. The dashboard layout fetches session/plan defensively for chrome (email, Analytics link) but never redirects from there.

4. **Use shadcn via MCP** when possible. `bunx shadcn@latest add <component>` works too. Don't hand-write primitives that already exist in shadcn (menu) or `@iedora/design-system` (all products).

5. **No `middleware.ts`.** Next 16 renamed it to **`proxy.ts`**. The proxy is for *optimistic* redirects only (cookie presence checks). Real auth always lives in the DAL.

6. **Money is integer cents** in `priceCents`, currency in a separate column. Never use floats for prices.

7. **Drag-and-drop reordering** uses integer `position` columns (per parent). On reorder, recompute positions for affected rows in a single transaction. Renumber periodically if gaps grow.

8. **Menu templates are open/closed.** Each template lives in its own folder under `src/features/menu-publishing/rsc/templates/<id>/` and exports a `template: MenuTemplate` from `index.ts`. The renderer (`menu-renderer.tsx`) consumes only the registry — never edit it to support a new template. Adding a template = new folder + 1 import + 1 entry in `templates/registry.ts` + the literal in `RestaurantTheme.layout` (schema). LAYOUTS in `src/features/menu-publishing/rsc/theme.ts` is derived from the registry; do not maintain it separately.

9. **Asset keys are tenant-prefixed and verified twice.** Every uploaded object's S3 key starts with `r/{restaurantId}/`. The `requireRestaurantAccess` DAL guard runs first; `assertKeyBelongsToTarget` then rejects any commit whose key doesn't match the target's restaurant — defense-in-depth against a stale presign being redirected. New asset targets must follow the same `r/{restaurantId}/...` scheme in `src/features/upload/targets.ts` and gate item-scoped uploads with an extra ownership check (see `assertItemBelongsToRestaurant`).

10. **Languages live in a registry.** Each supported language is a self-contained module under `src/features/i18n/languages/<code>/` exporting `language: Language` from its `index.ts`. `src/features/i18n/registry.ts` is the only place that knows the full set; `LANGUAGE_CODES`, `LANGUAGE_META`, and `getLanguage` are derived. The Zod schemas in actions use `z.record(z.string(), …).refine(keys ⊂ LANGUAGE_CODES)` because Zod 4 makes `z.record(z.enum([...]), …)` exhaustive. Translatable text uses the pattern: plain `name`/`description` text columns are the source of truth for the restaurant's `defaultLanguage`; sibling jsonb `*I18n` columns carry overrides for non-default languages. Fallback chain at render time: requested → default → empty. New languages: see `/add-language` skill.

11. **Plans live in a registry.** Same shape as languages and templates: each plan is a folder under `src/features/plans/<code>/` exporting `plan: Plan` from `index.ts`; `src/features/plans/registry.ts` derives `PLAN_CODES`, `PLANS`, `getPlan`. Adding a plan = new folder + new literal in `PlanCode` union + new registry entry. Gates use `canAddRestaurant(orgId)` (returns structured `{ ok, reason, limit }` — never throws) and `planHas(plan, feature)`. The DB column `organization.plan` stores raw text; `getPlan` coerces unknown values back to the default so a renamed plan never crashes a render.

12. **Public menu is cached, invalidated by tag.** `loadRestaurantSnapshot(slug)` and `loadRestaurantAdminMenus(slug)` (use-cases in `src/features/menu-publishing/use-cases/`) wrap `unstable_cache` with a per-slug tag `restaurant:${slug}` via `src/features/menu-publishing/cache.ts`. Every mutation that affects the restaurant's public or admin view MUST call `revalidateRestaurant(slug)` (which uses `updateTag` for read-your-own-writes semantics, not `revalidateTag`). The single chokepoint is enforced — never call `revalidatePath('/r/${slug}')` from a mutation action; the cache tag is what matters. **Date gotcha:** `unstable_cache` JSON-serializes Dates to ISO strings; if a cached function returns a Date the caller will see a string. Hydrate explicitly in the loader (see `loadRestaurantAdminMenus`).

13. **View tracking is beacon-based, not server-render-coupled.** `/api/track/[slug]` is a pixel-beacon route that lives outside the cached snapshot — it runs on every public visit, even when the page itself is served from cache. Dedup is `(visitor_cookie, restaurant_id, hour_bucket)` via `view_seen.onConflictDoNothing`; only newly-inserted rows trigger `incrementDailyView`. Bot UAs filtered at the route. **Never put the view increment back inline in the page** — that breaks the moment a CDN sits in front. `incrementDailyView` is the single chokepoint that emits BOTH the `daily_view` row AND the `iedora.restaurant_views_total` OTel counter (labeled by restaurant + org + language). The counter fires BEFORE the DB upsert — a DB outage doesn't lose the metric, so a row-count / metric divergence becomes a visible alert signal.

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via *relative* paths; cross-slice imports go through the sibling slice's `index.ts` (barrel) — enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`. The barrel-only rule has five sanctioned exceptions for cross-slice subpath imports: `actions` (Next's `'use server'` doesn't traverse barrels reliably), `client` (slice's browser-only API — server-only barrels can't re-export it), `server` (server-only entry for slices like `i18n`), `ui/**` (kept off the barrel so the RSC tree doesn't pull a whole slice's UI eagerly), and `rsc/**` (server-only render layer, e.g. `menu-publishing/rsc/`). Anything else (`adapters/*`, `ports`, `use-cases/*`, `types`, `targets`, `cache`, …) is slice-private. `src/shared/` is for primitives with no domain knowledge (db client, env, ui primitives, testing fixtures). `src/app/` is delivery — routes import from slices and shouldn't carry business logic. Use-cases take their port as the first argument so the test suite wires fakes against a real PGLite database (see `src/features/auth/auth.test.ts`); production wires the Drizzle adapter once in the slice's `index.ts` or `actions.ts`.

## File layout

```
products/menu/
  src/
    app/                             Next.js App Router
      (auth)/                          public auth pages (signup, login)
      _components/landing/             landing-page.tsx + landing.css (public home)
      dashboard/                       admin pages — protected
        analytics/                     Casa-only KPIs + scan chart; free → billing redirect
        billing/                       current plan + invoice ledger (year filter)
        r/[slug]/                      restaurant home
          m/[menuId]/                  dnd-kit menu builder route
          theme/                       settings: identity + theme editor
          qr/                          QR code generator
        layout.tsx, page.tsx
      r/[slug]/                        public menu page per restaurant — cached snapshot
      onboarding/                      first-org-creation AND add-another-restaurant flow
      api/
        auth/[...all]/                 Better Auth handler
        track/[slug]/                  pixel-beacon view tracking (cookie dedup + bot filter)
        identity/webhook/              identity webhook receiver via @iedora/identity (dead until Zitadel cutover)
      up/                              health-check route
      showcase/                        public marketing surface (template gallery)
      page.tsx, layout.tsx, globals.css
    features/
      auth/                          session + tenant-scoping guards (Better Auth)
      billing/                       invoice ledger
      dashboard-home/                restaurants-with-counts aggregate query
      i18n/                          per-language registry (en, pt, es, fr) + format helpers
      identity/                      OAuth-bearer adapter (dead — genkan deleted; Zitadel adapter pending issue #19 Phase 3+)
      menu-builder/                  dnd-kit admin builder
      menu-publishing/               public menu cache + renderer + template registry + sample seed
      metrics/                       daily-view + analytics range helpers
      plans/                         plan registry (free, casa) — same pattern as i18n/templates
      rate-limit/                    Redis (testcontainers in dev/CI) — Better Auth rate-limit store
      restaurant-identity/           restaurant CRUD + theme/identity settings
      upload/                        S3-compatible uploads + presign/commit/clear (LocalStack in CI)
    shared/
      db/{client.ts,schema.ts}       drizzle client + canonical schema
      env.ts                         Zod-validated env (build-time stub when SKIP_ENV_VALIDATION=1)
      brand.ts                       brand strings (inlined into client bundle at build)
      ui/                            shadcn primitives + editorial-list
      testing/pglite.ts              makeTestDb() fixture
      utils.ts                       cn() helper
    proxy.ts                         Next 16 proxy (was middleware) — optimistic redirects only
    i18n/                            next-intl request config + message catalogues
  drizzle/                           generated SQL migrations
  drizzle.config.ts                  schema path → ./src/shared/db/schema.ts
  next.config.ts, tsconfig.json      Next + TS config (paths: @/* → ./src/*)
  docker-compose.yml                 postgres + localstack (dev only)
  .env.example                       Next.js dev template — copy to .env.local
  package.json                       menu deps; workspace deps to @iedora/design-system
  scripts/
    check-migrations.ts              dev-time guardrail; warns when journal has pending migrations
  tests/e2e/
    fixtures.ts                      auto-fixture: fails fast on any RSC error / 5xx response
    specs/                           organized by module: auth, tenancy, menu-builder, public-menu, …
    helpers/                         shared signup/org/db utilities
  infra/                             menu product's deploy machinery
    Dockerfile                       app build (multi-stage Bun-install + Node-build + standalone)
    justfile                         deploy/destroy/rotate-secret/logs/etc. recipes; `set dotenv-load`
    .env.example                     infra template — copy to infra/.env (gitignored)
    bin/with-secrets                 BWS-env wrapper; injects TF_VAR_* aliases
    tofu/                            Cloudflare tunnel + DNS + R2 assets bucket (encrypted state)
    kamal/                           Kamal 2 — app + cloudflared accessory (NO postgres/backups —
                                     those are Tofu-managed `infra-*` containers in /infra/tofu/containers.tf)
```

## Commands

- `bun run dev` — Next.js dev server (Turbopack). Warns at startup when migrations are pending.
- `bun run typecheck` — TS check without emit.
- `bun run lint` — ESLint (boundary rules included).
- `bun run test` / `bun run test:watch` — Vitest unit suite (PGLite, co-located).
- `bun run test:e2e` / `:ui` / `:debug` — Playwright suite (production build + start).
- `bun run db:generate` — generate a Drizzle migration from `src/shared/db/schema.ts`.
- `bun run db:migrate` — apply pending migrations.
- `bun run db:push` — push schema directly (dev only, no migration files).
- `bun run db:studio` — open Drizzle Studio.
- `bun run auth:generate` — sync Better Auth tables into `src/shared/db/schema.ts`.
- `docker compose up -d` — start Postgres + LocalStack (S3 mock).
- `bunx shadcn@latest add <name>` — add a shadcn component.

Deploy commands live at the repo root — see `AGENTS.md` § Useful commands.
