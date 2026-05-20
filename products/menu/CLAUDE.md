# Menu — `products/menu/`

Menu-specific hard rules, file layout, and commands. Root `AGENTS.md` covers cross-cutting conventions.

Menu is a SaaS multi-tenant restaurant menu builder (menu.iedora.com). Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.

> **Identity status.** Zitadel (`auth.iedora.com`) is the iedora IdP. Menu still uses Better Auth locally for sessions; the cutover to Zitadel OIDC is queued under issue #20. Until then, `src/features/identity/` is dead code (was the genkan-http adapter; awaiting a Zitadel rewrite).

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

12. **Public menu is cached, invalidated by tag.** `loadRestaurantSnapshot(slug)` and `loadRestaurantAdminMenus(slug)` wrap `unstable_cache` with a per-slug tag `restaurant:${slug}` via `src/features/menu-publishing/cache.ts`. Every mutation MUST call `revalidateRestaurant(slug)` (uses `updateTag` for read-your-own-writes semantics, not `revalidateTag`). Never `revalidatePath('/r/${slug}')` from a mutation. **Date gotcha:** `unstable_cache` JSON-serializes Dates; hydrate explicitly in the loader.

13. **View tracking is beacon-based.** `/api/track/[slug]` is a pixel-beacon route outside the cached snapshot — runs every public visit even when the page is served from cache. Dedup is `(visitor_cookie, restaurant_id, hour_bucket)` via `view_seen.onConflictDoNothing`; only new rows trigger `incrementDailyView`. Bot UAs filtered at the route. Never put the view increment back inline in the page. `incrementDailyView` is the single chokepoint that emits BOTH the `daily_view` row AND the `iedora.restaurant_views_total` OTel counter (counter fires BEFORE the DB upsert so a DB outage doesn't lose the metric).

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via relative paths; cross-slice imports go through the sibling's `index.ts` (enforced by `eslint-plugin-boundaries`). Five sanctioned exceptions for cross-slice subpath imports: `actions` (`'use server'` doesn't traverse barrels), `client` (browser-only API), `server` (server-only entry), `ui/**` (kept off the barrel), `rsc/**` (server-only render layer). Everything else is slice-private. `src/shared/` is for primitives with no domain knowledge. `src/app/` is delivery — routes compose slice exports. Use-cases take their port as the first argument so tests wire fakes against a real PGLite database.

## File layout

```
products/menu/
  src/
    app/                             Next.js App Router
      (auth)/                          public auth pages (signup, login)
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
        auth/[...all]/                 Better Auth handler
        track/[slug]/                  pixel-beacon view tracking
        identity/webhook/              identity webhook receiver (dead — awaiting Zitadel cutover)
      up/                              health-check route
      showcase/                        public marketing surface
      page.tsx, layout.tsx, globals.css
    features/
      auth/                          session + tenant-scoping guards (Better Auth)
      billing/                       invoice ledger
      dashboard-home/                restaurants-with-counts aggregate
      i18n/                          per-language registry (en, pt, es, fr)
      identity/                      dead code — awaiting Zitadel OIDC adapter (issue #20)
      menu-builder/                  dnd-kit admin builder
      menu-publishing/               public menu cache + renderer + template registry
      metrics/                       daily-view + analytics range helpers
      plans/                         plan registry (free, casa)
      rate-limit/                    Redis (testcontainers in dev/CI) — Better Auth rate-limit store
      restaurant-identity/           restaurant CRUD + theme/identity
      upload/                        S3-compatible uploads + presign/commit/clear (LocalStack in CI)
    shared/
      db/{client.ts,schema.ts}       drizzle client + canonical schema
      env.ts                         Zod-validated env (build-time stub when SKIP_ENV_VALIDATION=1)
      brand.ts                       brand strings (inlined into client bundle at build)
      ui/                            shadcn primitives + editorial-list
      testing/pglite.ts              makeTestDb() fixture
      utils.ts                       cn() helper
    proxy.ts                         Next 16 proxy — optimistic redirects only
    i18n/                            next-intl request config + message catalogues
  drizzle/                           generated SQL migrations
  drizzle.config.ts
  next.config.ts, tsconfig.json      paths: @/* → ./src/*
  docker-compose.yml                 postgres + localstack (dev only)
  .env.example
  package.json                       workspace deps to @iedora/design-system, identity, observability
  scripts/check-migrations.ts        dev-time guardrail
  tests/e2e/
    fixtures.ts                      auto-fixture: fails fast on RSC errors / 5xx responses
    specs/                           organized by module
    helpers/                         shared signup/org/db utilities
  infra/                             menu-product-local deploy machinery
    Dockerfile                       app build (Bun-install + Node-build + standalone)
    justfile                         R2 assets bucket + DNS recipes
    .env.example
    bin/with-secrets                 BWS-env wrapper
    tofu/                            assets R2 bucket + assets.iedora.com (encrypted state)
```

The menu app container itself (`docker_container.menu_web`) is declared in `infra/tofu/containers.tf` at the repo root, not here.

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
- `bun run auth:generate` — sync Better Auth tables into schema.ts.
- `docker compose up -d` — Postgres + LocalStack.
- `bunx shadcn@latest add <name>` — add a shadcn component.

Deploy commands live at the repo root — see `AGENTS.md` § Useful commands.
