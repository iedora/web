# shared/

Cross-cutting primitives with no domain knowledge.

- `ui/editorial-list/` — the editorial restaurant-list row used by the dashboard. All other UI primitives (Button, Card, Dialog, Field, Separator, Table, Tabs, Toast, …) come from `@iedora/design-system`.
- `db/` — drizzle client + schema (single canonical schema)
- `env.ts` — Zod-validated runtime env
- `utils.ts` — generic helpers (cn, …)
- `testing/` — PGLite fixture + test helpers

Anything domain-specific belongs in `features/<slice>/`, not here.
