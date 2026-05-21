# Architecture — the iedora monorepo

How code is organised across the product and shared packages, and what you do when adding a feature.

## Shape

**iedora** is a Bun-workspaces monorepo with one Next.js product (Menu), one Astro static site (House), and two shared packages (`@iedora/design-system`, `@iedora/observability`). Inside menu, code is organised as **vertical slices** on the outside and **light hexagonal** on the inside. Each business capability lives in `src/features/<slice>/` and owns everything it needs: a port (interface to the outside world), one or more adapters (production + tests), pure-ish use-cases that take the port as their first argument, an `actions.ts` shell for Next.js Server Actions, slice-owned UI, and a single `index.ts` barrel. `src/shared/` holds primitives with no domain knowledge. `src/app/` is the delivery layer. **Next.js is a delivery detail**, not the architecture.

## Monorepo

```
iedora/
  packages/
    design-system/                @iedora/design-system    (editorial CSS + React primitives)
    iedora-observability/         @iedora/observability    (OTel wiring — traces + metrics)
  products/
    menu/                         menu.iedora.com          (SaaS menu builder)
    house/                        iedora.com               (Astro static landing)
  bun.lock                        single workspace lockfile
```

Bun workspaces because: `bun install` is fast, the lockfile is a single `bun.lock`, `workspace:*` deps resolve via symlinks (edit a package, re-run a product's test — no rebuild). Considered pnpm (mature, similar story) and Nx/Turbo (orchestration). Both add a layer we don't need at this scale; CI runs are fast enough that per-package caching hasn't been worth the config cost.

## Vertical slices + light hexagonal

Menu's slices share the same five files (give or take co-located tests and UI):

```
src/features/<slice>/
├── README.md                     short doc — public API + the why
├── index.ts                      public API: cached page guards + types
├── ports.ts                      narrow interfaces describing every external effect
├── adapters/
│   ├── drizzle.ts                production adapter against Drizzle + Postgres
│   └── …                         alternative adapters (zitadel-oidc, s3, …)
├── use-cases/<verb>.ts           pure-ish (port, input) -> result
├── actions.ts                    'use server' shells: auth guard → use-case → revalidate
├── ui/                           slice-owned React components (optional)
├── <slice>.test.ts               co-located Vitest suite — fakes the port, hits PGLite
├── testing/                      server-only test surface (profile + seeds + routes + barrel)
└── e2e/<capability>.spec.ts      Playwright specs scoped to this slice
```

Reference: `products/menu/src/features/auth/` — ports, two adapters, several use-cases, one co-located test. Larger slices (e.g. `menu-builder`, `menu-publishing`, `upload`) add `types.ts` / `format.ts` for domain helpers; smaller slices collapse the boilerplate (e.g. `i18n` has no adapter — the language registry is pure data).

## Menu's slice inventory

Path: `products/menu/src/features/`.

- **`auth/`** — session + tenant-scoping guards (Zitadel OIDC via `openid-client` + JWE cookie via `jose`). `verifySession`, `requireRestaurantAccess`, `requireRestaurantBySlug`, `requireActiveOrganization`.
- **`billing/`** — invoice ledger (read-only today).
- **`dashboard-home/`** — restaurants-with-counts aggregate query.
- **`i18n/`** — per-language registry (en, pt, es, fr) + format helpers + `LocalizedFields` editor UI.
- **`identity/`** — federated organization ownership through Zitadel (`auth.iedora.com`). Calls Zitadel's REST management API using the menu service-account PAT (IAM_OWNER) for memberships and org provisioning.
- **`menu-builder/`** — dnd-kit admin builder. Menu / category / item CRUD + reorder (position recompute in a single transaction).
- **`menu-publishing/`** — public-side render path. `loadRestaurantSnapshot` / `loadRestaurantAdminMenus` cache wrappers (per-slug tag), template registry, renderer, sample-data seed.
- **`metrics/`** — daily-view counters + analytics range helpers. Writes are driven by the beacon endpoint, not this slice.
- **`plans/`** — plan registry (free, casa). Same shape as i18n + templates.
- **`rate-limit/`** — token-bucket rate limiter backed by Redis (testcontainers in dev/CI). Guards `/api/auth/*` and other unauth'd endpoints.
- **`restaurant-identity/`** — restaurant CRUD + theme/identity settings.
- **`upload/`** — S3-compatible uploads. Presign + commit + clear, with the `r/{restaurantId}/...` key-prefix invariant verified twice. LocalStack in dev, `adobe/s3mock` in CI (LocalStack `:latest` requires a paid licence as of 2026); real R2 in production.

## Shared packages

### `@iedora/design-system` — `packages/design-system/`

Editorial primitives every product renders out of. Paper, ink, cinnabar; Fraunces + JetBrains Mono; hairline rules. Ships:

- CSS bundle (`styles.css`, `tokens.css`, `fonts.css`) imported once in each product's root layout.
- React component barrel: editorial chrome (`Wordmark`, `MetaStrip`, `Statement`, `Lintel`), motion primitives (`ScrollPinned`, `Phrases`, `Timeline`, `Wave`), Manual's §VI primitives (`Button`, `Card`, `Dialog`, `Field`, `Table`, `Toast`, `Tabs`, `Breadcrumb`, …).

Consumed by menu and house. Tests in `packages/design-system/src/test/` (jsdom + Testing Library).

Menu also keeps shadcn primitives under `products/menu/src/shared/ui/` — pieces without an editorial equivalent (e.g. `dropdown-menu`, `label`) stay menu-local until the design system grows to subsume them.


Tests are DB-less — pure crypto + parsing.

### `@iedora/observability` — `packages/iedora-observability/`

One-line OTel wiring per product. Wraps `@vercel/otel` — resource attrs + sampler + noise filter + 60s metrics reader. Exports `registerIedoraOtel`, `tracer`, `meter`, `withTenantSpan`, `tenantAttributes`. See `docs/observability.md` for the integration walkthrough.

## When to put code where

- **Knows about menu's domain (menus, restaurants, plans, audit logs, OAuth grants)?**
  → `products/menu/src/features/<slice>/`. New slice if no existing one fits; new use-case in an existing slice otherwise.
- **Primitive with no domain knowledge that menu uses?**
  → `products/menu/src/shared/`. DB client, env validation, shadcn primitives, test fixtures, `cn()`.
- **Both products need the same code?**
  → A workspace package under `packages/`. Bar is real reuse, not "might someday." When in doubt, copy twice; promote on the third use.
- **Visual chrome that the brand renders identically across products?**
  → `@iedora/design-system`.
- **Observability shared surface?**
  → `@iedora/observability`.
- **Next.js route file?**
  → `src/app/`. Routes compose slice exports; not where business logic lives.
- **Next 16 long-running background job (cron, queue consumer)?**
  → A slice use-case + a `start*()` driver in the slice, wired from `src/instrumentation.ts`. Gated on `NEXT_RUNTIME === 'nodejs'`.

## The contract

- **`ports.ts`** — narrow interfaces describing the slice's effects on the outside world. One method per atomic operation. No Drizzle / Next / OIDC-library types leak through; the slice's `Session` shape is defined in `auth/ports.ts` and is plain TS, not an upstream re-export.
- **`adapters/`** — implementations. Production adapters marked `'server-only'`. Tests build their own adapter against PGLite.
- **`use-cases/<verb>.ts`** — `async function verb(port: Port, input): Promise<Result>`. Pure-ish. The only Next API allowed inline is `redirect()` / `notFound()` — tests mock those.
- **`index.ts`** — binds the production adapter, wraps page-level loaders in `React.cache()`, re-exports the types callers need. Does NOT export the adapter.
- **`actions.ts`** — `'use server'` at the top. Each export: auth guard → call the use-case with the production adapter → revalidate (`revalidateRestaurant(slug)` per the cache rule).

## Cross-slice rules

- Files **inside** a slice import siblings via relative paths.
- Files **across** slices import only via the sibling barrel (`@/features/auth`). Reaching into `@/features/auth/use-cases/...` is a boundary violation flagged by `eslint-plugin-boundaries`.
- `src/shared/*` is freely importable — the only horizontal layer.
- Use-cases inside a slice don't call into other slices. If two slices need to coordinate, the coordination happens in the action shell or in the page component that composes both.
- **No cross-product imports.** Menu reaches `@iedora/observability`; nothing reaches across products' source trees.

## The Next.js boundary

- **`'use server'`** lives only in `actions.ts`. Next's directive doesn't traverse barrels reliably — re-exporting an action through `index.ts` silently breaks it.
- **`'server-only'`** lives at the top of adapters, use-cases, and slice barrels that touch the DB. Crashes at import if anything pulls the module into a Client Component.
- **Slice-owned UI** lives at `src/features/<slice>/ui/*`. Client components declare `'use client'`; Server Components do not need a marker.
- **Route files** in `src/app/` are composition shells: call slice loaders + render slice UI. The route should be small enough to read in one screen.
- **`src/instrumentation.ts`** is Next 16's process-init hook — use it to start long-running jobs. Gate on `NEXT_RUNTIME === 'nodejs'`.
- **No `middleware.ts`.** Next 16 renamed it to `proxy.ts`. The proxy is for *optimistic* redirects only.

## How to add a feature

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}` — `ui/` only if needed.
2. Sketch **`ports.ts`** first. One method per atomic effect.
3. Implement **`adapters/drizzle.ts`** (or the relevant production adapter). Mark `'server-only'`.
4. Write **`use-cases/<verb>.ts`** — pure functions taking the port as the first arg. Validate input with Zod inline; return `{ error: '...' }` on failure (don't throw).
5. Wire **`index.ts`**: bind production adapter, wrap loaders in `React.cache()`, re-export types.
6. If mutations, add **`actions.ts`** with `'use server'`. Each action: auth guard → use-case → revalidate.
7. Co-located **`<slice>.test.ts`** — use `makeTestDb()` from `@/shared/testing/pglite`, hand-roll a port adapter against the test DB.
8. **`testing/`** + **`e2e/`** — slice's E2E surface (`profile.ts` / `seeds.ts` / `routes.ts` / barrel) + Playwright specs. See [products/menu/CLAUDE.md](../products/menu/CLAUDE.md) rule 15.
9. Short **`README.md`** at the slice root.
10. Compose the slice from `src/app/`. The route file should be a thin shell.

Registry-shaped features (asset targets, languages, plans, templates) have dedicated skills under `.claude/skills/` — use them.

## What goes in `src/shared/`

- `db/client.ts` — singleton `postgres-js` client (HMR-safe via `globalThis`).
- `db/schema.ts` — the single canonical schema.
- `env.ts` — Zod-validated runtime env. Build-time stub Proxy when `SKIP_ENV_VALIDATION=1`.
- `brand.ts` — brand strings; inlined into the client bundle at build.
- `ui/` — shadcn primitives + generic cross-slice components.
- `utils.ts` — `cn()` and other framework-agnostic helpers.
- `testing/pglite.ts` — `makeTestDb()` fixture.

If it knows about menus, restaurants, plans, languages, uploads, it does NOT belong here. Put it in the slice.

## What goes in `src/app/`

- **Routes** — `<path>/page.tsx`, `<path>/layout.tsx`, `api/<route>/route.ts`. Compose slice exports.
- **Private folders** — `_components/<name>/` for page-local UI that only one route uses (Next's `_*` convention keeps them out of routing).
- **No business logic.** No Drizzle queries, no Zod schemas, no domain rules. If a route grows them, lift to the slice.

## Anti-patterns

- **A Repository class per entity.** We have ports per slice, not per table.
- **A DI container.** Use-cases take their port as the first arg; `index.ts` binds production. That's the whole DI story.
- **A `domain/` or `entities/` folder.** Drizzle row types are domain-enough.
- **A `lib/` folder for new code.** We migrated away from that.
- **A barrel inside a slice.** Only the slice root `index.ts` is a barrel; inner folders import each other directly.
- **A Server Action in a non-`actions.ts` file.** Next's `'use server'` doesn't traverse barrels reliably.
- **Reaching into a sibling slice's internals.** Importing `@/features/auth/use-cases/...` bypasses the barrel and breaks the lint rule.

See [`AGENTS.md`](../AGENTS.md) for hard rules and the full file layout. See [`testing.md`](testing.md) for the test pyramid.
