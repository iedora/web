# shared/

Cross-cutting primitives with no domain knowledge.

- `api.ts` — the typed client for the Go menu service (the product's ONLY data surface; DTOs mirror `services/internal/menu`).
- `ui/editorial-list/` — the editorial restaurant-list row used by the dashboard. All other UI primitives (Button, Card, Dialog, Field, Separator, Table, Tabs, Toast, …) come from `@iedora/design-system`.
- `env.ts` — Zod-validated runtime env (only `NEXT_PUBLIC_MENU_URL` survives the Go migration).
- `url.ts` — `publicUrl()` absolute-URL builder.
- `utils.ts` / `format.ts` — generic helpers (cn, price formatting, …).

Anything domain-specific belongs in `features/<slice>/`, not here.
