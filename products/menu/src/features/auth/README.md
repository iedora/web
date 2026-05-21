# auth slice

Session resolution + tenant access guards. The DAL of the project lives here.

Menu is a thin Zitadel OIDC client. Org membership lives on Zitadel; this
slice federates it via `@/features/identity`. The session itself is a
server-side row owned by `@/features/sessions` — the `menu_session_v2`
cookie carries only an opaque pointer.

## Public API (`@/features/auth`)

- `verifySession()` — redirects to `/api/auth/login` if no session
- `getEffectiveOrganizationId(userId)` — first Zitadel org for the user
- `requireActiveOrganization()` — session + org, else `/onboarding`
- `requireRestaurantAccess(id)` — verifies membership + returns restaurant
- `requireRestaurantBySlug(slug)` — same, resolved by URL slug

All wrappers are `React.cache()`-memoized per request.

## Ports

- `AuthGateway` (`./ports.ts`) — session cookie + Drizzle restaurant lookup
- `IdentityGateway` (`@/features/identity/ports`) — Zitadel management API

Adapters:
- `./adapters/drizzle.ts` — production restaurant lookup + cookie open →
  `sessionStore.get(sid)` → bounce if revoked / expired.
- `./adapters/session.ts` — encrypted session cookie (jose, dir / A256GCM).
  Cookie payload is `{ sid, sub, exp }` only; permissions + roles live on
  the server-side row owned by `@/features/sessions`.
- `./adapters/oidc.ts` — openid-client v6 wrapper for the auth-code dance.

## Routes

- `GET /api/auth/login?next=<path>` — mints PKCE+state, 302 to Zitadel
- `GET /api/auth/callback` — exchanges code, inserts a `menu.session` row,
  sets `menu_session_v2` cookie carrying the row's opaque `sid`
- `GET|POST /api/auth/logout` — revokes the server-side row, clears
  cookie, 302 to Zitadel end-session

## Revocation model

The cookie is just a pointer; the authoritative state is `menu.session`.
That gives us three guarantees the pre-#21 self-contained cookie didn't:

1. **Admin revoke** (`revokeSession(sid, 'admin_revoke')`) takes effect on
   the user's next request, no waiting on the 7-day cookie TTL.
2. **Scope changes** ride the Zitadel Actions v2 webhook
   (`/api/zitadel/permissions`) — when it fires, the webhook also calls
   `refreshPermissionsForUser`, which rewrites `roles` + `permissions`
   on every active row for the user. Their NEXT request sees the new set.
3. **Cookie leak** is bounded — a captured cookie is useless once the
   row is revoked.

### Live grant-change refresh

A second Zitadel Actions v2 target (`menu_grants`, see
`infra/tofu/zitadel.tf` + parity in `infra/dev/tofu/main.tf`) fires on
the seven `user.grant.{added,changed,cascade.changed,removed,
cascade.removed,deactivated,reactivated}` events. The
`/api/zitadel/grants-changed` route validates the HMAC with
`ZITADEL_GRANTS_SIGNING_KEY`, re-fetches the user's current iedora-
project grants via the mgmt API, expands roles to scopes, and calls
`refreshPermissionsForUser` — so a grant change reflects on the user's
next request without re-auth.

Known limitation: `user.grant.deactivated` / `reactivated` carry an
empty payload in Zitadel (`Payload() returns nil`), so the parser
can't extract a userId. Those events are silently skipped; the row's
permissions stay stale until the next login, which the function
webhook still refreshes.

The cookie name was bumped to `menu_session_v2` on the cutover. Pre-#21
self-contained cookies still in the wild fail closed (decryption
succeeds, missing `sid` → null → user re-auths).

## Why this exists

AGENTS.md hard rule #3 says auth checks live in the data layer, not in
layouts. Every page that touches `restaurant`/`menu`/`category`/`item`
must call one of these guards close to the data fetch.
