# sessions slice

Server-side session store. Replaces the self-contained JWE cookie that
used to carry every claim — the cookie now holds an opaque pointer
(`sid`) to a row owned by this slice. Permissions + roles live on the
row so a grant change (Zitadel webhook) or admin revoke is reflected on
the very next request, without waiting for the 7-day cookie TTL.

## Public API (`@/features/sessions`)

- `sessionStore` — the production-wired SessionStore. Read it directly
  from the auth slice (`getSession`) and the admin UI. Write paths
  should always go through one of the wrappers below so audit /
  telemetry has a single chokepoint.
- `listAllActiveSessions()` — cross-tenant listing, `React.cache()`
  memoized per request. Powers the admin UI; caller MUST gate by
  `requireIedoraAdmin`.
- `revokeSession(id, reason)` — mark a session revoked. Next request
  using that cookie sees `revokedAt != null` and is bounced through OIDC.
- `revokeAllForUser(userId, reason)` — nuke every active session for a
  user. Used by the admin UI when a grant change needs immediate effect.
- `refreshPermissionsForUser(userId, { roles, permissions })` — rewrite
  the resolved permission set on every active session for a user. Called
  from the Zitadel Actions v2 webhook so a grant change takes effect on
  the next request without re-auth.

## Admin UI (`/dashboard/admin/sessions`)

`requireIedoraAdmin` gated. Renders a `Table` of every active session
across every org with per-row Revoke + per-user Revoke-all. The caller's
own session is tagged "(this device)" so it can't be revoked by accident
(a confirm dialog warns). Server actions in `actions.ts` re-gate on the
admin role and `revalidatePath('/dashboard/admin/sessions')` after each
mutation.

## Port

`SessionStore` (`./ports.ts`). Production adapter:
`./adapters/drizzle.ts` (Postgres, `menu.session` table).

## Why this exists

Previously the menu session was a JWE cookie holding all the claims
directly. Two failure modes:

1. **No revoke.** Disabling a user in Zitadel had no effect on their
   menu session — they kept the cookie until it expired (up to 7d).
2. **Stale permissions.** Adding/removing a scope wouldn't reach the
   user until they re-authenticated.

This slice owns the row that fixes both. The cookie becomes a 256-bit
opaque id; everything else lives in `menu.session`. Lookups are PK-only
(sub-millisecond), `last_seen_at` is touched at most once per minute per
session.

## Why not put the row id in plaintext?

The cookie is still a JWE so the cookie value is opaque even to passive
network observers / log aggregators. It's defence in depth — a logged
cookie value isn't a usable bearer token without the symmetric key.
