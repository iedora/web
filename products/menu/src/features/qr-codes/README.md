# qr-codes slice

Cross-tenant registry of printable sticker codes. Each row maps a short
`code` (e.g. `abc12345`) to a `restaurantId` (nullable). Public scanners hit
`menu.iedora.com/q/<code>` → resolver redirects to `/r/<slug>` of the bound
restaurant.

## Who can touch it

CRUD is gated by `requireIedoraAdmin` — the cross-tenant `iedora-admin`
role on the better-auth `user.role` field (granted out-of-band only,
not via public signup).
The slice intentionally has **no tenant scoping** — that's the point. The
admin can bind any code to any restaurant across orgs.

## Public API (`@/features/qr-codes`)

- `resolveQrCode(code)` → `{ code, restaurantSlug } | null` — the public
  resolver. Returns null for unknown, unbound, or malformed codes alike.
- `listQrCodesForAdmin()` → `QrCodeListRow[]` — admin reader; caller MUST
  have already passed `requireIedoraAdmin`.

## Server actions (`./actions.ts`)

All wrapped in `requireIedoraAdmin` + `revalidatePath('/dashboard/admin/qr-codes')`:

- `createCodeAction({ code?, restaurantId?, label? })` — admin-supplied
  custom code OR auto-generated if `code` omitted. Optional bind on create.
- `bulkGenerateAction(count)` — mints N unbound auto-generated codes
  (1..500). Returns the codes actually inserted (PK collisions skipped).
- `bindCodeAction({ code, restaurantId })` — bind/rebind an existing row.
- `unbindCodeAction(code)` — clear restaurant on a row.
- `deleteCodeAction(code)` — remove the row entirely.

## Code shape

- Custom: 1..64 chars of `[a-z0-9_-]`, normalised to lower-case.
- Auto-generated: 8 chars from a Crockford-style alphabet (no 0/1/I/L/O/U).
  ~39 bits of entropy — collision-resistant for batches in the thousands;
  PK uniqueness is the final guard.

## Schema

`menu.qr_code(code PK, restaurant_id FK -> restaurant.id ON DELETE SET NULL,
label, created_at, bound_at)`. Restaurant deletes unbind the sticker rather
than destroy it — the physical sticker is still re-bindable.

## Tests

Co-located `qr-codes.test.ts` runs against PGLite — same Drizzle calls as
production, no network. The test gateway shadows the production adapter
shape so the same SQL is exercised end-to-end.
