# Menu — `products/menu/`

Menu-specific hard rules, file layout, and commands. Root `AGENTS.md` covers cross-cutting conventions.

Menu is a SaaS multi-tenant restaurant menu builder (menu.iedora.com). Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.

> **Layout post-Opt-B**: this package contains the menu **slices, drizzle schema, shared UI, and i18n catalogs** — but NOT the Next.js routes. Every `page.tsx` / `route.ts` / `layout.tsx` / `actions.ts` lives in `apps/web/src/app/`. Those route files import slice barrels here via the `@/...` path mapping in apps/web's tsconfig (`@/* → ../../products/menu/src/*`). Adding a route = edit `apps/web/src/app/`; adding a slice or a use-case = edit here.

> **Identity.** `@iedora/core-auth` is the shared auth surface — better-auth (email+password, organization, admin plugins) running IN-PROCESS inside menu. Sessions and orgs live in the dedicated `core` Postgres database (better-auth tables in the `core` schema). The `better-auth.session_token` cookie scopes on `.iedora.com` so a login here will work on the future `core` product too. `src/features/auth/` owns the DAL guards + the role/scope taxonomy (`scopes.ts` maps `qr-codes:read|write|…` strings to better-auth's `{qrCodes:['read']}` permission shape; `requireScope()` short-circuits when `session.user.role === 'iedora-admin'`). Cross-tenant data (memberships, org provisioning) is reached via `auth.api.*` — never via direct SQL against `core.*`. See `packages/core-auth/README.md` for the consumer contract.

## Hard rules

Paths starting with `src/...` are menu-relative.

1. **Tenant scoping is mandatory.** Every query touching `restaurant`, `menu`, `category`, or `item` MUST filter by `restaurantId` AND verify the caller is a member of the parent organization. Never trust IDs from the client without rechecking ownership. Centralize via `requireRestaurantAccess(restaurantId)` in `src/features/auth/`.

2. **Schema is the source of truth.** `src/shared/db/schema.ts` is canonical. Migrations are generated, not handwritten — `bun run db:generate` then `bun run db:migrate`.

3. **Auth checks belong in the data layer, not in layouts.** Layouts in Next 16 don't re-render on navigation; auth in a layout WILL leak. Use `verifySession()` / `requireRestaurantAccess()` close to the data fetch. The dashboard layout reads session/plan defensively for chrome, never redirects.

4. **Use shadcn via MCP** when possible (or `bunx shadcn@latest add <component>`). Don't hand-write primitives that already exist in shadcn or `@iedora/design-system`.

5. **No `middleware.ts`.** Next 16 renamed it to **`proxy.ts`**. The proxy is for *optimistic* redirects only (cookie presence checks). Real auth lives in the DAL.

6. **Money is integer cents** in `priceCents`, currency in a separate column. Never floats for prices.

7. **Drag-and-drop reordering** uses integer `position` columns (per parent). On reorder, recompute positions for affected rows in a single transaction. Renumber when gaps grow.

8. **Menu templates are open/closed.** Each template lives in its own folder under `src/features/menu-publishing/rsc/templates/<id>/` and exports a `template: MenuTemplate` from `index.ts`. The renderer consumes only the registry — never edit it for a new template. Adding one = new folder + 1 import + 1 entry in `templates/registry.ts` + the literal in `RestaurantTheme.layout`. `LAYOUTS` in `theme.ts` is derived from the registry; do not maintain separately.

9. **Asset keys are tenant-prefixed and verified twice.** Every uploaded object's S3 key starts with `r/{restaurantId}/`. `requireRestaurantAccess` runs first; `assertKeyBelongsToTarget` rejects any commit whose key doesn't match. New asset targets follow the same scheme in `src/features/upload/targets.ts` and gate item-scoped uploads with `assertItemBelongsToRestaurant`.

10. **Languages live in a registry.** Each supported language is a folder under `src/features/i18n/languages/<code>/` exporting `language: Language`. `src/features/i18n/registry.ts` is the only place that knows the full set. Translatable text uses the pattern: plain `name`/`description` is the source of truth for `defaultLanguage`; sibling jsonb `*I18n` columns hold non-default overrides. Fallback at render: requested → default → empty. New languages via `/add-language` skill.

11. **Plans live in a registry.** Each plan is a folder under `src/features/plans/<code>/`. Gates use `canAddRestaurant(orgId)` (returns `{ ok, reason, limit }` — never throws) and `planHas(plan, feature)`. `organization.plan` stores raw text; `getPlan` coerces unknowns back to the default so a renamed plan never crashes a render.

12. **Public menu is cached, invalidated by tag.** `loadRestaurantSnapshot(slug)` and `loadRestaurantAdminMenus(slug)` wrap `unstable_cache` with a per-slug tag `restaurant:${slug}` via `src/features/menu-publishing/cache.ts`. Every mutation MUST call `revalidateRestaurant(slug)` (uses `updateTag` for read-your-own-writes semantics, not `revalidateTag`). Never `revalidatePath('/menu/r/${slug}')` from a mutation. **Date gotcha:** `unstable_cache` JSON-serializes Dates; hydrate explicitly in the loader.

13. **View tracking is beacon-based.** `/api/track/[slug]` is a pixel-beacon route outside the cached snapshot — runs every public visit even when the page is served from cache. Dedup is `(visitor_cookie, restaurant_id, hour_bucket)` via `view_seen.onConflictDoNothing`; only new rows trigger `incrementDailyView`. Bot UAs filtered at the route. Never put the view increment back inline in the page. `incrementDailyView` is the single chokepoint that emits BOTH the `daily_view` row AND the `iedora.restaurant_views_total` OTel counter (counter fires BEFORE the DB upsert so a DB outage doesn't lose the metric).

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via relative paths; cross-slice imports go through the sibling's `index.ts` (enforced by `eslint-plugin-boundaries`). **Six** sanctioned exceptions for cross-slice subpath imports: `actions` (`'use server'` doesn't traverse barrels), `client` (browser-only API), `server` (server-only entry), `ui/**` (kept off the barrel), `rsc/**` (server-only render layer), **`testing` / `testing/**`** (slice's public test surface — see rule 15). Everything else is slice-private. `src/shared/` is for primitives with no domain knowledge. `src/app/` is delivery — routes compose slice exports. Use-cases take their port as the first argument so tests wire fakes against a real PGLite database.

15. **Tests co-locate with the slice they exercise.** Each slice owns `testing/` (`'server-only'`: `profile.ts` derived from `./scopes`, `seeds.ts`, `routes.ts`, barrel `index.ts`) and `e2e/<capability>.spec.ts` (Playwright specs). Cross-slice flows live ONLY at `tests/e2e/journeys/`. `tests/e2e/helpers/` is zero-domain — anything with domain knowledge moves into the owning slice's `testing/`. Production code (adapters / use-cases / ui / actions / rsc) MUST NOT import `testing/*` (enforced by `no-restricted-imports`). Tag specs with `@smoke` / `@critical` for selective execution. See [tests/README.md](tests/README.md) for the spec template + multi-tenant pattern.

16. **Redirects build URLs via `publicUrl()`.** Every absolute URL the server hands to the browser (NextResponse.redirect Location, post-login redirect, post-logout URL) MUST be built via `publicUrl()` from `@/shared/url` (publicUrl) or `@iedora/brand`. Never derive from `req.url`, `req.nextUrl.origin`, `req.nextUrl.clone()`, or `req.headers.get('host')` — Cloudflare Tunnel terminates TLS at the edge and forwards plain HTTP to the upstream bind `HOSTNAME=0.0.0.0 PORT=3000`; any URL built from those carries the internal bind and the browser can't follow `http://0.0.0.0:3000/...`. User-supplied path inputs (`?next=`, `return_url=`) MUST be validated with `isSameOriginPath()` from `@iedora/brand` (env-free, safe to import from unit tests) BEFORE being passed to `publicUrl()`. `req.nextUrl` is fine as a *path source* — pass `req.nextUrl.pathname` AS A PATH into `publicUrl()`. ESLint doesn't catch this; manual review at code time is the only gate.

17. **Every dashboard page renders through `<DashboardPage>`.** The shell at `src/shared/ui/dashboard-page.tsx` owns the standard chrome — `space-y-10` vertical rhythm, breadcrumb (always prefixed with **Home** → `/menu/dashboard`, never "Back"), the title-as-`<BreadcrumbHere>`-h1, plus optional `eyebrow` / `description` / `actions` slots. Pages just supply `title`, `crumbs` for intermediate sections, and their content. Root `/menu/dashboard` opts out of the breadcrumb with `root`. Auto-generates namespaced `data-test-id`s (`{ns}-breadcrumb-home`, `{ns}-breadcrumb-current`, `{ns}-header`, `{ns}-actions`) so specs target the shell without per-page boilerplate. Don't hand-roll `<h1>Back / Title</h1>` or `<div className="space-y-{6|8|10}">` chrome in a page anymore — the rhythm has drifted twice already.

> Plus the **cross-product hard rules** in [`docs/agents/cross-product-rules.md`](../../docs/agents/cross-product-rules.md): `data-test-id` on every interactive component, and visible UI text via `next-intl` (`src/i18n/messages/<locale>.json` + `useTranslations()` / `getTranslations()`). Both bind here.

## File layout

```
apps/web/
  src/
    app/                             Next.js App Router
      (auth)/                          public auth pages (signup, login) — better-auth client
      _components/landing/             landing-page.tsx + landing.css
      dashboard/                       admin pages — protected
        analytics/                     Casa-only KPIs; free → billing redirect
        billing/                       current plan + invoice ledger
        r/[slug]/                      restaurant home
          m/[menuId]/                  dnd-kit menu builder route
          theme/                       settings: identity + theme editor
          qr/                          QR code generator
        layout.tsx, page.tsx
      r/[slug]/                        public menu page — cached snapshot
      onboarding/                      first-org-creation + add-another-restaurant
      api/
        auth/[...all]/                 better-auth catch-all (login/logout/session/org/admin)
        track/[slug]/                  pixel-beacon view tracking
      up/                              health-check route
      showcase/                        public marketing surface
      page.tsx, layout.tsx, globals.css
    features/                        every slice: {adapters,use-cases,ui,actions.ts,ports.ts,index.ts,
                                                    <slice>.test.ts, testing/, e2e/, README.md}
      auth/                          DAL guards + scopes.ts (role/scope taxonomy over @iedora/core-auth)
      billing/                       invoice ledger
      dashboard-home/                restaurants-with-counts aggregate
      i18n/                          per-language registry (en, pt, es, fr)
      menu-builder/                  dnd-kit admin builder
      menu-publishing/               public menu cache + renderer + template registry
      metrics/                       daily-view + analytics range helpers
      plans/                         plan registry (free, casa)
      qr-codes/                      physical-sticker registry (cross-tenant, iedora-admin only)
      rate-limit/                    Postgres-backed sliding-window limiter
      restaurant-identity/           restaurant CRUD + theme/identity
      restaurant-slug/               public-URL identifier — slugify + nextAvailableSlug + rename
      upload/                        S3-compatible uploads + presign/commit/clear (adobe/s3mock)
    shared/
      db/{client.ts,schema.ts}       drizzle client + canonical schema
      env.ts                         Zod-validated env (build-time stub when SKIP_ENV_VALIDATION=1)
      brand.ts                       brand strings (inlined into client bundle at build)
      ui/                            shadcn primitives + editorial-list
      testing/pglite.ts              makeTestDb() fixture
      url.ts                         publicUrl() — single source for absolute-URL construction (rule 16)
      url-validate.ts                isSameOriginPath() — pure, env-free path validator
      utils.ts                       cn() helper
    proxy.ts                         Next 16 proxy — optimistic redirects only (uses publicUrl)
    i18n/                            next-intl request config + message catalogues
  drizzle/                           generated SQL migrations
  drizzle.config.ts
  next.config.ts, tsconfig.json      paths: @/* → ./src/*
  Dockerfile                         app build (Bun-install + Node-build + standalone). Same Dockerfile dev (built locally) and prod (built + pushed to Gitea OCI registry pelo job `deploy` de .gitea/workflows/deploy.yml) consume.
  .env                               Holds local stack defaults (infra-postgres, infra-s3mock infra-o2).
                                     Container reads it via env_file; bun run dev
                                     also reads it.
  .env.local                         User-owned, gitignored. Your overrides.
                                     Higher precedence than .env.
                                     The orchestrator only READS it (looks for
                                     CORE_SECRET) — never writes to it.
                                     Use it for: session persistence (copy the
                                     secret here), remote services (real S3,
                                     hosted DB), HMR DB URLs (localhost instead
                                     of Docker network hostnames).
                                     See docs/dev.md § Environment files.
  package.json                       workspace deps to @iedora/core-auth, @iedora/design-system, @iedora/observability
  scripts/check-migrations.ts        dev-time guardrail
  tests/e2e/
    fixtures.ts                      auto-fixture: fails fast on RSC errors / 5xx responses
    global-setup.ts                  builds menu_test_template DB (migrations applied)
    global-teardown.ts               drops per-worker DBs
    helpers/                         (server-only stub today; future zero-domain helpers live
                                     under src/shared/testing/e2e-{db,storage,beacon}.ts)
    journeys/                        cross-slice user journeys (tenant-isolation, onboarding,
                                     menu-build-and-publish, qr-to-public-view, plan-upgrade, …)
```

Dev: `bun run dev:up` boots the local database/S3 containers. See [docs/dev.md](../../docs/dev.md) for details.

Prod: job `deploy` de `.gitea/workflows/ci.yml` (gated por `needs:
[ci, audit]`) corre `kamal deploy`, que faz build remoto no Beelink,
push para Gitea OCI registry, corre migrations via pre-deploy hook, e
faz blue-green swap.

## Commands

- `bun run dev` — Next.js dev server (Turbopack). Warns when migrations are pending.
- `bun run typecheck` — TS check without emit.
- `bun run lint` — ESLint (boundary rules included).
- `bun run test` / `bun run test:watch` — Vitest unit suite (PGLite, co-located).
- `bun run test:e2e` / `:ui` / `:debug` — Playwright suite (production build + start).
- `bun run db:generate` — generate a Drizzle migration.
- `bun run db:migrate` — apply pending migrations.
- `bun run db:push` — push schema directly (dev only).
- `bun run db:studio` — Drizzle Studio.
- `bun run dev:up` (from repo root) — boots the local Docker stack (postgres + s3mock). See [docs/dev.md](../../docs/dev.md).
- `bunx shadcn@latest add <name>` — add a shadcn component.

Deploy commands live at the repo root — see [`AGENTS.md`](../../AGENTS.md) § Commands.
