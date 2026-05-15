# Architecture — the slice playbook

> One-line purpose: how the codebase is organised, why it's organised that way,
> and what you do when you add a new feature.
> **Last updated:** 2026.

## The shape in one paragraph

Meta Menu is organised as **vertical slices** on the outside and **light
hexagonal** on the inside. Each business capability lives in
`src/features/<slice>/` and owns everything it needs: a port (the interface to
the outside world), one or more adapters (production + tests), pure-ish
use-cases that take the port as their first argument, an `actions.ts` shell
for Next.js Server Actions, slice-owned UI, and a single `index.ts` barrel
that exposes the public API. `src/shared/` holds primitives with no domain
knowledge. `app/` is the delivery layer — routes compose use-cases and UI.
**Next.js is a delivery detail**, not the architecture.

## Slice anatomy — `src/features/auth/`

```
src/features/auth/
├── README.md                     short doc — public API + the why
├── index.ts                      public API: cached page guards + AuthGateway type
├── client.ts                     Better Auth React client (browser-side)
├── ports.ts                      AuthGateway interface (getSession, find*)
├── adapters/
│   ├── better-auth-instance.ts   the betterAuth() factory (Drizzle adapter, plugins)
│   └── better-auth.ts            production AuthGateway against Drizzle + Better Auth
├── use-cases/
│   ├── verify-session.ts         (auth) -> redirects to /login or returns session
│   ├── get-effective-organization-id.ts
│   ├── require-active-organization.ts
│   ├── require-restaurant-access.ts
│   └── require-restaurant-by-slug.ts
└── auth.test.ts                  co-located Vitest suite — fakes the port, hits PGLite
```

Every slice keeps the same shape. Larger slices (e.g. `menu-builder`,
`menu-publishing`, `upload`) also add an `actions.ts` for `'use server'`
shells, a `ui/` folder for slice-owned components, and sometimes
`types.ts` / `format.ts` / `range.ts` for domain helpers. Smaller slices
collapse the boilerplate (`src/features/i18n/` has no adapter layer because the
language registry is pure data).

## Why this shape

We landed on it after an audit of an earlier `lib/`-flat structure. The
problems were the usual ones for a growing Next.js app: domain code mixed
with framework code; auth, DB, and rendering tangled in the same file; tests
that needed half the world to run; "where does X go?" had no answer.

Vertical slices solve the layout question: every feature is a folder you can
read top-to-bottom. The light hexagonal layer inside a slice keeps the
**domain logic testable** without a full Next request context — use-cases
take a port, so a Vitest test wires that port to a real PGLite database
instead of mocking Drizzle. We deliberately stopped short of a full
DDD/onion arrangement; there is no `domain/`, no `entities/`, no DI
container. The port is the only seam.

## The contract

- **`ports.ts`** — narrow interfaces describing the slice's effects on the
  outside world. One method per atomic operation. No Drizzle / Next /
  Better Auth types leak through (`Session` is the one exception: it's
  Better Auth's own type re-exported via the adapter).
- **`adapters/`** — implementations. The production adapter is marked
  `'server-only'`. Tests build their own adapter against PGLite (see
  `src/features/auth/auth.test.ts`).
- **`use-cases/<verb>.ts`** — `async function verb(port: Port, input): Promise<Result>`.
  Pure-ish: takes inputs, returns outputs, calls port methods. The only
  Next API allowed inline is `redirect()` / `notFound()` — and tests mock
  those (see `tests` doc).
- **`index.ts`** — binds the production adapter, wraps page-level loaders
  in `React.cache()`, re-exports the types callers actually need. Does
  *not* export the adapter.
- **`actions.ts`** — `'use server'` at the top. Each export: auth guard
  (from `@/features/auth`) → call the use-case with the production adapter
  → `revalidateRestaurant(slug)` if the mutation touches public data.

## Cross-slice rules

- Files **inside** a slice import siblings via relative paths
  (`./adapters/drizzle`, `../ports`).
- Files **across** slices import only via the sibling barrel
  (`@/features/auth`, `@/features/menu-publishing`). Reaching into
  `@/features/auth/use-cases/...` from another slice is a boundary
  violation flagged by `eslint-plugin-boundaries`.
- `src/shared/*` is freely importable from anywhere — it's the only horizontal
  layer.
- Use-cases inside a slice do not call into other slices. If two slices
  need to coordinate, the coordination happens in the action shell or in
  the page component that composes both. Slices stay leaf-shaped.

## The Next.js boundary

- **`'use server'`** lives only in `actions.ts`. Next's directive does not
  traverse barrels reliably — re-exporting an action through `index.ts`
  silently breaks it.
- **`'server-only'`** lives at the top of adapters, use-cases, and slice
  barrels that touch the DB. It crashes at import if anything pulls the
  module into a Client Component, which is the protection we want.
- **Slice-owned UI** lives at `src/features/<slice>/ui/*`. Client components
  declare `'use client'` themselves; Server Components do not need a
  marker.
- **Route files** in `app/` are composition shells: page → call slice
  loaders + render slice UI. The route should be small enough to read in
  one screen; if it isn't, the missing piece is a slice helper.

## How to add a new feature

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}` — `ui/` only if needed.
2. Sketch **`ports.ts`** first. Write the interface as if the rest of the
   world doesn't exist; one method per atomic effect.
3. Implement **`adapters/drizzle.ts`** (or the relevant production
   adapter). Mark `'server-only'`.
4. Write **`use-cases/<verb>.ts`** — pure functions taking the port as the
   first argument. Validate input with Zod inline (return
   `{ error: '...' }` on failure; don't throw).
5. Wire **`index.ts`**: bind the production adapter, wrap page loaders in
   `React.cache()`, re-export the public types.
6. If there are mutations, add **`actions.ts`** with `'use server'`. Each
   action: `requireRestaurantBySlug(slug)` → run use-case →
   `revalidateRestaurant(slug)` (hard rule #12).
7. Add **`<slice>.test.ts`** alongside the source. Use `makeTestDb()` from
   `@/shared/testing/pglite`, hand-roll a port adapter against the test
   DB, and exercise the use-cases. See `src/features/auth/auth.test.ts`.
8. Write a short **`README.md`** at the slice root: public API, port
   summary, one-line rationale.
9. Compose the slice from `app/` (one route imports the loader + UI, the
   other imports the action). The route file should be a thin shell.

Registry-shaped features (asset targets, languages, plans, templates) have
dedicated skills under `.claude/skills/`. Use those instead of inventing a
new pattern.

## What goes in `src/shared/`

- `src/shared/db/client.ts` — singleton `postgres-js` client (HMR-safe via `globalThis`).
- `src/shared/db/schema.ts` — the single canonical schema. Auth tables, domain
  tables, everything.
- `src/shared/env.ts` — Zod-validated runtime env. Returns a build-time stub
  Proxy when `SKIP_ENV_VALIDATION=1` so `next build` can collect page data
  without secrets.
- `src/shared/ui/` — shadcn primitives (`button`, `card`, `dialog`, …) and
  generic cross-slice components like the editorial list. Nothing
  domain-shaped.
- `src/shared/utils.ts` — `cn()` and other framework-agnostic helpers.
- `src/shared/testing/pglite.ts` — the `makeTestDb()` fixture used by every
  unit test.

If it knows about menus, restaurants, plans, languages, uploads, or
analytics, it does NOT belong here. Put it in the slice.

## What goes in `app/`

- **Routes** — `app/<path>/page.tsx`, `app/<path>/layout.tsx`,
  `app/api/<route>/route.ts`. These compose slice exports.
- **Private folders** — `app/_components/<name>/` for page-local UI that
  only one route uses (Next's `_*` convention keeps them out of the
  routing table). `app/_components/landing/` is the canonical example.
- **No business logic.** A route file should not contain Drizzle queries,
  Zod schemas, or domain rules. If it does, lift it into the slice.

## Anti-patterns

- **A Repository class per entity.** We have ports per slice, not per
  table.
- **A DI container.** Use-cases take their port as the first argument;
  `index.ts` binds the production one. That's the whole DI story.
- **A `domain/` or `entities/` folder.** Drizzle row types are
  domain-enough. Add helpers in `<slice>/types.ts` if you really need a
  named alias.
- **A `lib/` folder for new code.** That was the structure we migrated
  away from. New code goes in `src/features/<slice>/` or `src/shared/`.
- **A barrel inside a slice.** Only the slice root `index.ts` is a barrel;
  inner folders import each other directly so the dependency graph stays
  legible.
- **A Server Action in a non-`actions.ts` file.** Next's `'use server'`
  directive doesn't traverse barrels reliably; symptom is a bundling
  error or a silently-broken mutation.
- **Reaching into a sibling slice's internals.** Importing
  `@/features/auth/use-cases/require-restaurant-access` directly bypasses
  the barrel and breaks the lint rule. Use `@/features/auth`.

See [`AGENTS.md`](../AGENTS.md) for the 14 hard rules and the full file
layout. See [`testing.md`](testing.md) for the test pyramid.
