# features/

Vertical slices. One folder per business capability.

## Slice shape

Each slice is self-contained UI + thin server glue over the Go menu
service (`services/cmd/menu`). There is no data layer here — the Go
side owns validation, tenancy and persistence.

- `index.ts` — the slice's public API: `React.cache()`-wrapped read loaders over `shared/api.ts` + types
- `actions.ts` — `'use server'` shells: typed API call → `ApiError` → `{ error }` → revalidate
- `ui/` — client components for the slice
- `<pure-helper>.ts` + `.test.ts` — pure domain helpers with co-located Vitest suites

Full contract in [`docs/agents/slice-pattern.md`](../../../../docs/agents/slice-pattern.md).

## Cross-slice rules

- Intra-slice imports use relative paths.
- Inter-slice imports go through `@/features/<slice>` (the barrel
  `index.ts`) or the sanctioned `actions` / `ui/**` / `rsc/**` subpaths.
- Slices may import from `@/shared/*` freely (api / ui / url / utils / env).

## Current inventory

| Slice | What |
|---|---|
| **`auth`** | Session guards over `@iedora/api-client`: `getSession`, `verifySession`, `requireActiveOrganization`, `requireRestaurantBySlug`, `requireStaff`, `isStaff`. Decide where to send the visitor; authorization is the Go service's. |
| **`dashboard-home`** | Restaurants-with-counts loader + dashboard chrome UI (analytics cards, logout, locale switcher). |
| **`i18n`** | Per-language registry (en, pt, es, fr) + format helpers + `LocalizedFields` editor UI. |
| **`menu-builder`** | dnd-kit admin builder. Menu / category / item CRUD + reorder, one thin action per Go endpoint. |
| **`menu-onboarding`** | Tenant + first-restaurant flow (POST /auth/tenants → refresh → POST /api/restaurants) + seed-or-skip step 2. |
| **`menu-publishing`** | Public-side render path: `loadPublicMenu` over `GET /public/r/{slug}` (pre-localized), template registry, the `/track/{slug}` view beacon. |
| **`metrics`** | Analytics loaders over `GET /api/analytics` + `/api/views/month`. |
| **`plans`** | Plan loader over `GET /api/plan` + static display registry (codes mirror Go's `PlanRegistry`). |
| **`qr-codes`** | Physical-sticker registry (cross-tenant, staff only). Thin wrappers over `/api/staff/qr-codes` + pure code/stats/print helpers. |
| **`restaurant-identity`** | Theme/identity/language settings actions over the identity PATCH + staff directory loader. |
| **`restaurant-slug`** | Pure `slugify` / `isValidSlugShape` helpers. Allocation + rename live in the Go menu service. |
| **`upload`** | Presign → browser PUT → commit against the Go menu service. Client-side constraint hints only. |

## Anti-patterns

- A data layer in TypeScript — no ORMs, repositories, ports/adapters.
  Backend behaviour changes are Go work (`services/`).
- Re-validating business rules in actions — the Go service 422s;
  actions only translate errors for the UI.
- A `lib/` folder for new code — we migrated away from that.
- A barrel inside a slice — only the slice root `index.ts` is a barrel.
- A Server Action in a non-`actions.ts` file — `'use server'` doesn't traverse barrels reliably.
- Reaching into a sibling slice's internals — bypasses the barrel.
