# features/

Vertical slices. One folder per business capability.

Each slice is self-contained:
- `use-cases/` — pure async functions with explicit port arguments
- `ports.ts` — interfaces the slice depends on (DB, storage, auth, …)
- `adapters/` — implementations of those ports (Drizzle, S3, better-auth, …)
- `actions.ts` — `'use server'` shim that wires Next's request to a use-case
- `ui/` — client components for the slice
- `<slice>.test.ts` — Vitest + PGLite tests for the use-cases
- `index.ts` — the slice's public API (only what other slices/app import)

Intra-slice imports use relative paths (`./use-cases/...`). Inter-slice
imports go through `@/features/<slice>` (which resolves to the slice's
`index.ts`). Slices may import from `@/shared/*` freely.
