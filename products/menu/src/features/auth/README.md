# auth slice

Session resolution + tenant access guards. The DAL of the project lives here.

Identity is sourced from **`@iedora/core-auth`** (better-auth running
in-process; see `packages/core-auth/README.md`). This slice does NOT call an
external IdP; it consumes `auth.api.*` directly and adds the menu-side
guards on top — tenant scoping, scope-string checks, the cross-tenant
`iedora-admin` short-circuit.

## Public API (`@/features/auth`)

- `verifySession()` — redirects to `/sign-in` if no session
- `getEffectiveOrganizationId(userId)` — first org for the user (via
  `auth.api.listOrganizations`); the session also carries
  `activeOrganizationId` for fast-path reads
- `requireActiveOrganization()` — session + org, else `/onboarding`
- `requireRestaurantAccess(id)` — verifies membership + returns restaurant
- `requireRestaurantBySlug(slug)` — same, resolved by URL slug
- `requireScope(scope)` — checks a `qr-codes:read|write|update|delete`
  string against the active session's permissions; short-circuits to
  allowed when `session.user.role === 'iedora-admin'`

All wrappers are `React.cache()`-memoized per request.

## Ports

- `AuthGateway` (`./ports.ts`) — session lookup + Drizzle restaurant
  lookup. The production adapter resolves the session via
  `auth.api.getSession({ headers })` against the in-process auth
  instance.

## Scopes ↔ permissions

`scopes.ts` is the source of truth for the human-readable scope strings
used at call sites (`qr-codes:read`, `qr-codes:write`, …). The
`scopeToPermission()` helper converts them to better-auth's
permission shape (`{qrCodes: ['read']}`) which is what the underlying
access-control engine in `@iedora/core-auth` actually checks.

## Routes

- `/api/auth/[...all]` — better-auth's catch-all. Owns sign-in / sign-up
  / sign-out / get-session / organization + admin plugin endpoints.
  Mounted by `toNextJsHandler(auth)` against the singleton from
  `@iedora/core-auth`.

## Session + cookie

Sessions are owned by better-auth (`core.session` table). The
`better-auth.session_token` cookie is scoped on `.iedora.com` so SSO
works across iedora products (menu today, `core` tomorrow). Cookie
domain is configured via `CORE_COOKIE_DOMAIN` (parent domain in
prod; `localhost` in dev).

Revocation: better-auth supports `auth.api.revokeSession({ token })`
for admin-revoke flows. An "all sessions for a user" admin view + bulk
revoke is deferred to the future `core` product (Phase 2).

## Why this exists

AGENTS.md hard rule #3 says auth checks live in the data layer, not in
layouts. Every page that touches `restaurant`/`menu`/`category`/`item`
must call one of these guards close to the data fetch.
