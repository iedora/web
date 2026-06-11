# Vertical slice pattern — the contract

Every Next.js product in the monorepo follows this. Imported into [AGENTS.md](../../AGENTS.md).

Code is organised as **vertical slices**: each business capability lives in `src/features/<slice>/` and owns its UI + the thin server glue that talks to the Go backend. Since the Go migration there is NO data layer on the TypeScript side — no ports/adapters/use-cases, no ORM, no DB fixtures. The Go services own validation, tenancy and persistence; a slice's server code is a thin typed pass-through.

## Slice file layout

```
src/features/<slice>/
├── index.ts                      public API: cached read loaders + types
├── actions.ts                    'use server' shells: typed API call → revalidate
├── ui/                           slice-owned React components (optional)
└── <pure-helper>.ts(.test.ts)    pure domain helpers + their Vitest suites
```

The typed Go client lives at **`src/shared/api.ts`** — one function per
endpoint, DTO types mirroring the Go structs (`services/internal/menu`).
It is the ONLY module that builds menu-service URLs. It sits on
`@iedora/api-client`'s `serverFetch`, which attaches the Bearer token
from the `iedora_access` cookie and refreshes once on 401.

Reference slices: `features/menu-builder` (read loader + a dozen thin
actions), `features/auth` (session guards only — no data), `features/plans`
(loader + a static display registry).

## The contract

- **`index.ts`** — read loaders wrapped in `React.cache()` so a guard
  called twice in one render hits the API once. Marked `'server-only'`.
  Maps Go DTOs into the shapes the UI renders where they differ.
- **`actions.ts`** — `'use server'` at the top. Each export: typed call
  from `shared/api.ts` → catch `ApiError` into `{ error: message }` →
  `revalidatePath(...)`. NO business validation beyond friendly-error
  zod parses — the Go service is the source of truth and will 422.
- **Full-replace updates**: the Go PATCH/PUT endpoints replace the whole
  text field set (name + description + i18n). Updating actions must
  receive the complete fields from the UI (which holds the tree in
  memory) so a rename doesn't wipe translations.
- **Auth**: `features/auth` exposes `getSession` / `verifySession` /
  `requireActiveOrganization` / `requireRestaurantBySlug` /
  `requireStaff`. These only decide where to SEND the visitor;
  authorization is enforced by Go on every call.

## Cross-slice rules

- Files **inside** a slice import siblings via relative paths.
- Files **across** slices import only via the sibling barrel
  (`@/features/auth`) or the sanctioned subpaths: `actions`, `ui/**`,
  `rsc/**`. Everything else is slice-private.
- `src/shared/*` is freely importable — the only horizontal layer
  (`api.ts`, `url.ts`, `env.ts`, `ui/`).
- Slices don't call each other's loaders from server code; coordination
  happens in the action shell or the page component that composes both.
- **No cross-product imports.** Menu reaches `@iedora/api-client` /
  `@iedora/design-system`; nothing reaches across products' source trees.

## The Next.js boundary

- **`'use server'`** lives only in `actions.ts`. Next's directive doesn't traverse barrels reliably — re-exporting an action through `index.ts` silently breaks it.
- **`'server-only'`** lives at the top of `index.ts` barrels and `shared/api.ts`. Crashes at import if anything pulls the module into a Client Component.
- **Slice-owned UI** lives at `src/features/<slice>/ui/*`. Client components declare `'use client'`; Server Components do not need a marker.
- **Route files** in `src/app/` are composition shells: call slice loaders + render slice UI. The route should be small enough to read in one screen.
- **No `middleware.ts`.** Next 16 renamed it to `proxy.ts`. The proxy owns host dispatch + the access-token refresh; redirects there are the gate, authorization lives in Go.

## How to add a feature

1. Add/extend the endpoint functions + DTOs in `src/shared/api.ts`
   (mirror the Go handler — read `services/internal/<svc>/httpapi/`).
2. `mkdir src/features/<slice>/{ui}` — `ui/` only if needed.
3. Wire **`index.ts`**: `React.cache()`-wrapped loaders over the api
   functions, re-export types.
4. If mutations, add **`actions.ts`** with `'use server'`. Each action:
   api call → `ApiError` → `{ error }` → revalidate.
5. Pure domain helpers (formatting, layout math, validation hints) get
   co-located Vitest suites.
6. Compose the slice from `src/app/`. The route file should be a thin shell.
7. Backend behaviour changes (new fields, new rules) are Go work first —
   `services/` — then the TS contract follows.
