# features/

Vertical slices. One folder per business capability.

## Slice shape

Each slice is self-contained:

- `use-cases/` — pure async functions with explicit port arguments
- `ports.ts` — interfaces the slice depends on (DB, storage, auth, …)
- `adapters/` — implementations of those ports (Drizzle, S3, better-auth, …)
- `actions.ts` — `'use server'` shim that wires Next's request to a use-case
- `ui/` — client components for the slice
- `<slice>.test.ts` — Vitest + PGLite tests for the use-cases
- `index.ts` — the slice's public API (only what other slices/app import)
- `testing/` (optional) — server-only test surface (profile + seeds + routes + barrel)
- `e2e/` (optional) — Playwright specs scoped to the slice

Full contract in [`docs/agents/slice-pattern.md`](../../../../docs/agents/slice-pattern.md).

## Cross-slice rules

- Intra-slice imports use relative paths (`./use-cases/...`).
- Inter-slice imports go through `@/features/<slice>` (the barrel
  `index.ts`). Reaching `@/features/auth/use-cases/...` is a boundary
  violation flagged by `eslint-plugin-boundaries`.
- Slices may import from `@/shared/*` freely (db / ui / testing /
  url / utils / env / log).

## Current inventory

| Slice | What |
|---|---|
| **`auth`** | DAL guards + role/scope taxonomy over `@iedora/core-auth`. `verifySession`, `requireRestaurantAccess`, `requireRestaurantBySlug`, `requireActiveOrganization`, `requireScope`. `scopes.ts` maps `qr-codes:read|write|update|delete` to better-auth's `{qrCodes: ['read']}` shape; `requireScope` short-circuits when `session.user.role === 'iedora-admin'`. |
| **`billing`** | Invoice ledger (read-only today). |
| **`dashboard-home`** | Restaurants-with-counts aggregate query for the dashboard root. |
| **`i18n`** | Per-language registry (en, pt, es, fr) + format helpers + `LocalizedFields` editor UI. |
| **`menu-builder`** | dnd-kit admin builder. Menu / category / item CRUD + reorder (positions recomputed in a single transaction). |
| **`menu-import`** | AI-assisted import of an existing menu (image / PDF → categories + items + variants). |
| **`menu-onboarding`** | First-org-creation + add-another-restaurant flows. |
| **`menu-publishing`** | Public-side render path. `loadRestaurantSnapshot` / `loadRestaurantAdminMenus` cache wrappers, template registry, sample-data seed. |
| **`menu-translation`** | AI translation pass over a menu's localised fields. |
| **`metrics`** | Daily-view counters + analytics range helpers (driven by the beacon route). |
| **`plans`** | Plan registry (free, casa). `canAddRestaurant(orgId)` gate. |
| **`qr-codes`** | Physical-sticker registry (cross-tenant, iedora-admin only). |
| **`rate-limit`** | Sliding-window rate limiter backed by Postgres (advisory locks + `READ COMMITTED`). |
| **`restaurant-identity`** | Restaurant CRUD + theme/identity settings. |
| **`restaurant-slug`** | Owner of `restaurant.slug`. `slugify`, `nextAvailableSlug`, `rename` (race-safe). |
| **`upload`** | S3-compatible uploads. Presign + commit + clear, `r/{restaurantId}/...` key prefix verified twice. |

## Anti-patterns

- A Repository class per entity — slices have ports, not per-table repos.
- A DI container — use-cases take their port as the first arg; `index.ts` binds production.
- A `domain/` or `entities/` folder — Drizzle row types are domain-enough.
- A `lib/` folder for new code — we migrated away from that.
- A barrel inside a slice — only the slice root `index.ts` is a barrel.
- A Server Action in a non-`actions.ts` file — `'use server'` doesn't traverse barrels reliably.
- Reaching into a sibling slice's internals — `@/features/auth/use-cases/...` bypasses the barrel.
