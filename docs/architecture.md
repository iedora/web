# Architecture — the iedora monorepo

How code is organised across the products and shared packages, plus the menu-side conventions and anti-patterns. The **slice contract itself** (file layout, ports/adapters/use-cases, cross-slice rules, how to add a feature) lives in [`docs/agents/slice-pattern.md`](agents/slice-pattern.md) — auto-loaded into agent context via AGENTS.md. This doc is the human-readable companion: monorepo overview, current slice inventory, where things go.

## Shape

**iedora** is a Bun-workspaces monorepo with one Next.js product (Menu) serving two hostnames — `menu.iedora.com` (menu app) and `iedora.com` (house landing, at `src/app/house/`) via a Host-based rewrite in `src/proxy.ts` — plus two shared packages (`@iedora/design-system`, `@iedora/observability`). Inside menu, code is organised as **vertical slices** on the outside and **light hexagonal** on the inside. Each business capability lives in `src/features/<slice>/` and owns everything it needs: a port (interface to the outside world), one or more adapters (production + tests), pure-ish use-cases that take the port as their first argument, an `actions.ts` shell for Next.js Server Actions, slice-owned UI, and a single `index.ts` barrel. `src/shared/` holds primitives with no domain knowledge. `src/app/` is the delivery layer. **Next.js is a delivery detail**, not the architecture.

## Monorepo

```
iedora/
  packages/
    design-system/                @iedora/design-system    (editorial CSS + React primitives)
    eslint-config/                @iedora/eslint-config    (flat-config factories)
    iedora-observability/         @iedora/observability    (OTel wiring — traces + metrics)
  products/
    menu/                         menu.iedora.com          (SaaS menu builder)
                                  iedora.com               (brand landing at src/app/house/)
  bun.lock                        single workspace lockfile
```

Bun workspaces because: `bun install` is fast, the lockfile is a single `bun.lock`, `workspace:*` deps resolve via symlinks (edit a package, re-run a product's test — no rebuild). Considered pnpm (mature, similar story) and Nx/Turbo (orchestration). Both add a layer we don't need at this scale; CI runs are fast enough that per-package caching hasn't been worth the config cost.

## Slice pattern

The full contract — file layout, ports/adapters/use-cases, cross-slice rules, Next.js boundary, how to add a feature — lives in [`docs/agents/slice-pattern.md`](agents/slice-pattern.md). Read that first; the rest of this doc is product-specific context.

## Menu's slice inventory

Path: `products/menu/src/features/`.

- **`auth/`** — session + tenant-scoping guards (Zitadel OIDC via `openid-client` + JWE cookie via `jose`). `verifySession`, `requireRestaurantAccess`, `requireRestaurantBySlug`, `requireActiveOrganization`.
- **`billing/`** — invoice ledger (read-only today).
- **`dashboard-home/`** — restaurants-with-counts aggregate query.
- **`i18n/`** — per-language registry (en, pt, es, fr) + format helpers + `LocalizedFields` editor UI.
- **`identity/`** — federated organization ownership through Zitadel (`auth.iedora.com`). Calls Zitadel's REST management API using the menu service-account PAT (IAM_OWNER) for memberships and org provisioning.
- **`menu-builder/`** — dnd-kit admin builder. Menu / category / item CRUD + reorder (position recompute in a single transaction).
- **`menu-import/`** — AI-assisted import of an existing menu (image / PDF → categories + items + variants), driven from the dashboard.
- **`menu-onboarding/`** — first-org-creation + add-another-restaurant flows (the empty-state journey).
- **`menu-publishing/`** — public-side render path. `loadRestaurantSnapshot` / `loadRestaurantAdminMenus` cache wrappers (per-slug tag), template registry, renderer, sample-data seed.
- **`menu-translation/`** — AI translation pass over a menu's localised fields (`name` / `description` → `*I18n`).
- **`metrics/`** — daily-view counters + analytics range helpers. Writes are driven by the beacon endpoint, not this slice.
- **`plans/`** — plan registry (free, casa). Same shape as i18n + templates.
- **`qr-codes/`** — physical-sticker registry (cross-tenant, iedora-admin only — owns the printed QR → restaurant binding).
- **`rate-limit/`** — sliding-window rate limiter backed by Postgres (advisory locks + `READ COMMITTED`; tests run against PGLite). Guards `/api/auth/*` and other unauth'd endpoints. (Previously Redis; see slice README for why we dropped it.)
- **`restaurant-identity/`** — restaurant CRUD + theme/identity settings.
- **`restaurant-slug/`** — owner of the `restaurant.slug` column. `slugify(name)` + `isValidSlugShape(s)` (pure), `nextAvailableSlug(base)` (onboarding auto-pick), `rename(restaurantId, newSlug)` (operator rename, race-safe via DB unique index). One shape rule, two surfaces.
- **`sessions/`** — authoritative server-side `menu.session` store (roles, permissions, `permissionsVersion`, revocation). The cookie is just a pointer; this slice is the source of truth — Zitadel Actions v2 webhooks rewrite rows live on grant change.
- **`upload/`** — S3-compatible uploads. Presign + commit + clear, with the `r/{restaurantId}/...` key-prefix invariant verified twice. LocalStack in dev, `adobe/s3mock` in CI (LocalStack `:latest` requires a paid licence as of 2026); real R2 in production.

## Shared packages

### `@iedora/design-system` — `packages/design-system/`

Editorial primitives every product renders out of. Paper, ink, cinnabar; Fraunces + JetBrains Mono; hairline rules. Ships:

- CSS bundle (`styles.css`, `tokens.css`, `fonts.css`) imported once in each product's root layout.
- React component barrel: editorial chrome (`Wordmark`, `MetaStrip`, `Statement`, `Lintel`), motion primitives (`ScrollPinned`, `Phrases`, `Timeline`, `Wave`), Manual's §VI primitives (`Button`, `Card`, `Dialog`, `Field`, `Table`, `Toast`, `Tabs`, `Breadcrumb`, …).

Consumed by menu and house. Tests in `packages/design-system/src/test/` (jsdom + Testing Library).

Menu also keeps shadcn primitives under `products/menu/src/shared/ui/` — pieces without an editorial equivalent (e.g. `dropdown-menu`, `label`) stay menu-local until the design system grows to subsume them.

### `@iedora/observability` — `packages/iedora-observability/`

One-line OTel wiring per product. Wraps `@vercel/otel` — resource attrs + sampler + noise filter + 60s metrics reader. Exports `registerIedoraOtel`, `tracer`, `meter`, `withTenantSpan`, `tenantAttributes`. See `docs/deploy.md` for the integration walkthrough.

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

## What goes in `src/shared/`

- `db/client.ts` — singleton `postgres-js` client (HMR-safe via `globalThis`).
- `db/schema.ts` — the single canonical schema.
- `env.ts` — Zod-validated runtime env. Build-time stub Proxy when `SKIP_ENV_VALIDATION=1`.
- `brand.ts` — brand strings; inlined into the client bundle at build.
- `ui/` — shadcn primitives + generic cross-slice components.
- `url.ts` — `publicUrl(path, searchParams?)` for every absolute URL the server hands the browser (CLAUDE.md rule 16). Never derive URLs from `req.url` / `req.nextUrl.origin`.
- `url-validate.ts` — `isSameOriginPath(raw)`, pure (no env import) so unit tests can use it without env standup.
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

See [`AGENTS.md`](../AGENTS.md) for hard rules + the full file layout. See [`agents/slice-pattern.md`](agents/slice-pattern.md) for the slice contract. See [`testing.md`](testing.md) for the test pyramid.
