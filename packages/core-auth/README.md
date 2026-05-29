# @iedora/core-auth

> Shared auth surface for the iedora estate — better-auth instance,
> Drizzle schema, and the role/scope access-control taxonomy. One config,
> shared by every product (menu today, core tomorrow).

Cookies seal on `.iedora.com` so a session created on any iedora surface
is readable by any other.

## What's in here

```
src/
  auth.ts          The canonical better-auth instance (lazy-init).
  client.ts        Browser-side client (better-auth/react + plugin set).
  db.ts            Postgres pool against the iedora_auth DB (lazy).
  role-presets.ts  Named bundles of scopes (iedora-admin/iedora-support + owner/admin/member/viewer) derived from `scopes.ts::SCOPES`.
  scopes.ts        Canonical scope catalogue (`SCOPES.<product>.<kind>.<resource>.<verb>`) — single source of truth for the taxonomy.
  schema.ts        Drizzle schema for the iedora_auth tables.
  index.ts         Server entry — re-exports the above.
drizzle/           Generated SQL migrations.
drizzle.config.ts  Migration tooling config.
```

## Quick start (consumer side)

```ts
// products/<x>/src/shared/auth.ts
import { getAuth } from '@iedora/core-auth'
export const auth = getAuth()

// products/<x>/src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/shared/auth'
export const { GET, POST } = toNextJsHandler(auth)

// In a server component / route handler:
import { headers } from 'next/headers'
import { auth } from '@/shared/auth'
const session = await auth.api.getSession({ headers: await headers() })
```

## Env vars (consumer-provided)

| Var | What |
|---|---|
| `CORE_DATABASE_URL` | Postgres URL pointing at the `core` DB (auth tables live in the `core` schema) |
| `CORE_SECRET`       | ≥ 32-char secret used to sign session tokens |
| `CORE_BASE_URL`     | Canonical URL of the auth API (e.g. `https://core.iedora.com`) |
| `CORE_TRUSTED_ORIGINS` | Comma-separated list of allowed origins for CSRF |
| `CORE_COOKIE_DOMAIN` | Override the parent-domain cookie scope (default `.iedora.com`; use `localhost` in dev) |

## Permission model

Two axes:

- **Per-org roles** — `member` / `admin` / `owner`. Resolved against the
  user's `member.role` row for their `session.activeOrganizationId`.
- **Cross-tenant role** — `iedora-admin`. Granted on the user row, NOT
  through membership; a single grant covers every org + every product.

Permission checks at the call site:

```ts
const ok = await auth.api.userHasPermission({
  body: {
    permission: { qrCodes: ['write'] },        // resource → actions
  },
  headers: await headers(),
})
if (!ok) redirect('/forbidden')
```

Extending the taxonomy = one entry in `scopes.ts::SCOPES`. The
`iedora-admin` / `owner` presets pick up new scopes automatically via
prefix filters; add explicit entries to `role-presets.ts::STAFF_ROLE_PRESETS`
/ `TENANT_ROLE_PRESETS` only when a narrower preset should also carry
the new scope.

## Migrations

Schema lives in `src/schema.ts`. Edit it, then:

```bash
bun run db:generate    # produces drizzle/NNNN_…sql
bun run db:migrate     # applies pending migrations
```

In prod, Stage 3 of the deploy pipeline runs `db:migrate` against the
`core` database (see `infra/app-state/`).

## Why a shared package, not a per-product config

- One source of truth for the role/permission taxonomy — adding a new
  scope is one PR, not "remember to update menu AND core".
- Cookies stay valid across surfaces because every consumer points at
  the SAME better-auth instance shape (same secret, same plugin set).
- The `core` DB / `core` schema is owned here too — schema drift cannot
  happen silently in a consumer's local migrations folder.

## Cross-product boundary (microservices-ready)

Products talk to `core` data EXCLUSIVELY through this package's API
(`auth.api.getSession`, `auth.api.hasPermission`,
`auth.api.createOrganization`, …). No consumer is allowed to:

- Open a Drizzle / postgres-js connection at `CORE_DATABASE_URL` and
  query `core.user` / `core.organization` / `core.member` directly.
- Add a foreign-key constraint from its own tables to anything under
  the `core` schema. Foreign references stay as plain `text` columns
  carrying the opaque id (e.g. `restaurant.organization_id`).
- Import Drizzle table objects from `@iedora/core-auth/schema` for read
  queries. The `schema` export exists for migrations and the package's
  own adapters; product code asks the API instead.

Why this matters: the day we split `core` off as its own service —
distinct repo, distinct DB, gRPC or HTTP boundary — the only thing that
has to change is this package's adapter (Drizzle → API client). Every
consumer's call sites stay identical because they already speak the
API surface, not SQL.

The same boundary applies in the other direction: `core` doesn't
import menu's schema or query menu's DB. Cross-product reads (e.g.
"how many restaurants does this org have?") go through whatever API
the owning product exposes.

## Not in scope

- SMTP wiring (`requireEmailVerification` is off; flip it on when SMTP
  lands).
- Audit log surface — that's the `core` product's concern (Phase 2).
- Admin UI for org/user management — also `core` (Phase 2).
