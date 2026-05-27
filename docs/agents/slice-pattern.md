# Vertical slice pattern — the contract

Every Next.js product in the monorepo follows this. House is Astro and doesn't have slices today, but if it ever grows interactive surfaces with shared business logic, the contract still applies. Imported into [AGENTS.md](../../AGENTS.md).

Code is organised as **vertical slices** on the outside and **light hexagonal** on the inside. Each business capability lives in `src/features/<slice>/` and owns everything it needs.

## Slice file layout

```
src/features/<slice>/
├── README.md                     short doc — public API + the why
├── index.ts                      public API: cached page guards + types
├── ports.ts                      narrow interfaces describing every external effect
├── adapters/
│   ├── drizzle.ts                production adapter against Drizzle + Postgres
│   └── …                         alternative adapters (better-auth, s3, …)
├── use-cases/<verb>.ts           pure-ish (port, input) -> result
├── actions.ts                    'use server' shells: auth guard → use-case → revalidate
├── ui/                           slice-owned React components (optional)
├── <slice>.test.ts               co-located Vitest suite — fakes the port, hits PGLite
├── testing/                      server-only test surface (profile + seeds + routes + barrel)
└── e2e/<capability>.spec.ts      Playwright specs scoped to this slice
```

Reference: `apps/web/src/features/auth/` — ports, two adapters, several use-cases, one co-located test. Larger slices (`menu-builder`, `menu-publishing`, `upload`) add `types.ts` / `format.ts` for domain helpers; smaller slices collapse the boilerplate (`i18n` has no adapter — the language registry is pure data).

## The contract

- **`ports.ts`** — narrow interfaces describing the slice's effects on the outside world. One method per atomic operation. No Drizzle / Next / better-auth types leak through; the slice's `Session` shape is defined in `auth/ports.ts` and is plain TS, not an upstream re-export.
- **`adapters/`** — implementations. Production adapters marked `'server-only'`. Tests build their own adapter against PGLite.
- **`use-cases/<verb>.ts`** — `async function verb(port: Port, input): Promise<Result>`. Pure-ish. The only Next API allowed inline is `redirect()` / `notFound()` — tests mock those.
- **`index.ts`** — binds the production adapter, wraps page-level loaders in `React.cache()`, re-exports the types callers need. Does NOT export the adapter.
- **`actions.ts`** — `'use server'` at the top. Each export: auth guard → call the use-case with the production adapter → revalidate (`revalidateRestaurant(slug)` per the cache rule).

## Cross-slice rules

- Files **inside** a slice import siblings via relative paths.
- Files **across** slices import only via the sibling barrel (`@/features/auth`). Reaching into `@/features/auth/use-cases/...` is a boundary violation flagged by `eslint-plugin-boundaries`.
- Six sanctioned cross-slice subpaths: `actions`, `client`, `server`, `ui/**`, `rsc/**`, `testing` / `testing/**`. Everything else is slice-private.
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
8. **`testing/`** + **`e2e/`** — slice's E2E surface (`profile.ts` / `seeds.ts` / `routes.ts` / barrel) + Playwright specs. See [products/menu/CLAUDE.md](../../products/menu/CLAUDE.md) rule 15.
9. Short **`README.md`** at the slice root.
10. Compose the slice from `src/app/`. The route file should be a thin shell.

Registry-shaped features (asset targets, languages, plans, templates) have dedicated skills under `.claude/skills/` — use them.
