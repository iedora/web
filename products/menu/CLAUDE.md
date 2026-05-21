# Menu — `products/menu/`

Menu-specific hard rules, file layout, and commands. Root `AGENTS.md` covers cross-cutting conventions.

Menu is a SaaS multi-tenant restaurant menu builder (menu.iedora.com). Each tenant is an organization that owns one or more `restaurant` rows. Admins build menus via drag-and-drop; the public menu renders from the same data.

> **Identity.** Zitadel (`auth.iedora.com`) is the iedora IdP. Menu is a thin OIDC client — `openid-client` v6 drives the auth-code/PKCE dance, `jose` seals an opaque pointer into the `menu_session_v2` cookie. The cookie carries only `{sid, sub, exp}`; the authoritative state is a server-side `menu.session` row owned by `src/features/sessions/` — roles, permissions, `permissionsVersion`, revocation. `src/features/auth/` owns the cookie + the DAL guards; `src/features/identity/` calls Zitadel's management API (memberships, org provisioning) via a TF-minted IAM_OWNER PAT. Zitadel Actions v2 webhooks rewrite the session row's permissions live on grant change — see `src/features/auth/README.md` for the revocation model.

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

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via relative paths; cross-slice imports go through the sibling's `index.ts` (enforced by `eslint-plugin-boundaries`). **Six** sanctioned exceptions for cross-slice subpath imports: `actions` (`'use server'` doesn't traverse barrels), `client` (browser-only API), `server` (server-only entry), `ui/**` (kept off the barrel), `rsc/**` (server-only render layer), **`testing` / `testing/**`** (slice's public test surface — see rule 15). Everything else is slice-private. `src/shared/` is for primitives with no domain knowledge. `src/app/` is delivery — routes compose slice exports. Use-cases take their port as the first argument so tests wire fakes against a real PGLite database.

15. **Tests co-locate with the slice they exercise.** Each slice owns `testing/` (`'server-only'`: `profile.ts` derived from `./scopes`, `seeds.ts`, `routes.ts`, barrel `index.ts`) and `e2e/<capability>.spec.ts` (Playwright specs). Cross-slice flows live ONLY at `tests/e2e/journeys/`. `tests/e2e/helpers/` is zero-domain — anything with domain knowledge moves into the owning slice's `testing/`. Production code (adapters / use-cases / ui / actions / rsc) MUST NOT import `testing/*` (enforced by `no-restricted-imports`). Tag specs with `@smoke` / `@critical` for selective execution. See [`../../docs/testing.md`](../../docs/testing.md) for the spec template + multi-tenant pattern.

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
        auth/login/                    OIDC start (PKCE+state cookie → Zitadel)
        auth/callback/                 OIDC callback (code → session cookie)
        auth/logout/                   clears cookie → Zitadel end_session
        track/[slug]/                  pixel-beacon view tracking
      up/                              health-check route
      showcase/                        public marketing surface
      page.tsx, layout.tsx, globals.css
    features/                        every slice: {adapters,use-cases,ui,actions.ts,ports.ts,index.ts,
                                                    <slice>.test.ts, testing/, e2e/, README.md}
      auth/                          OIDC client + session cookie + DAL guards (Zitadel native)
      billing/                       invoice ledger
      dashboard-home/                restaurants-with-counts aggregate
      i18n/                          per-language registry (en, pt, es, fr)
      identity/                      Zitadel management API — memberships + org provisioning
      menu-builder/                  dnd-kit admin builder
      menu-publishing/               public menu cache + renderer + template registry
      metrics/                       daily-view + analytics range helpers
      plans/                         plan registry (free, casa)
      qr-codes/                      physical-sticker registry (cross-tenant, iedora-admin only)
      rate-limit/                    Postgres-backed sliding-window limiter
      restaurant-identity/           restaurant CRUD + theme/identity
      sessions/                      menu.session store (authoritative roles/permissions)
      upload/                        S3-compatible uploads + presign/commit/clear (LocalStack in dev, adobe/s3mock in CI)
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
  Dockerfile                         app build (Bun-install + Node-build + standalone). Same Dockerfile dev (built locally by `just dev`) and prod (built + pushed to GHCR by .github/workflows/menu.yml) consume.
  .env                               TF-emitted (infra/modules/menu_env, localhost-DNS variant). Committed. Statics + Zod-valid placeholders for the dynamic keys.
  .env.local                         user-owned, gitignored. Real Zitadel + session values for the host bun-run-dev path; user can also override any key to point at remote services.
  package.json                       workspace deps to @iedora/design-system, identity, observability
  scripts/check-migrations.ts        dev-time guardrail
  tests/e2e/
    _bootstrap.ts                    Zitadel mock (OIDC discovery + mgmt API subset)
    fixtures.ts                      auto-fixture: fails fast on RSC errors / 5xx responses
    global-setup.ts                  builds menu_test_template DB (migrations applied)
    global-teardown.ts               drops per-worker DBs
    helpers/                         (server-only stub today; future zero-domain helpers live
                                     under src/shared/testing/e2e-{db,storage,beacon}.ts)
    journeys/                        cross-slice user journeys (tenant-isolation, onboarding,
                                     menu-build-and-publish, qr-to-public-view, plan-upgrade, …)
```

Dev: `just dev` boots a docker_container.menu (build local from this Dockerfile) on the iedora network — same image shape as prod. For HMR, `just dev --except menu && cd products/menu && bun run dev` (reads `.env` + `.env.local`).

Prod: `docker_container.menu_web` in `infra/tofu/containers.tf` pulls `ghcr.io/eduvhc/menu:<sha>` (CI-pushed) and runs on the Hetzner box.

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
- `docker compose up -d` — Postgres + LocalStack.
- `bunx shadcn@latest add <name>` — add a shadcn component.

Deploy commands live at the repo root — see `AGENTS.md` § Useful commands.
