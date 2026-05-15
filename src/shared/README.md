# shared/

Cross-cutting primitives with no domain knowledge.

- `ui/` — shadcn primitives, generic UI components reused across slices
- `db/` — drizzle client + schema (single canonical schema)
- `env.ts` — Zod-validated runtime env
- `utils.ts` — generic helpers (cn, …)
- `testing/` — PGLite fixture + test helpers

Anything domain-specific belongs in `features/<slice>/`, not here.
