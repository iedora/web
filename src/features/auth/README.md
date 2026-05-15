# auth slice

Session resolution + tenant access guards. The DAL of the project lives here.

## Public API (`@/features/auth`)

- `verifySession()` — redirects to /login if no session
- `getEffectiveOrganizationId(userId, sessionActive)` — resolves the org with the earliest-membership fallback
- `requireActiveOrganization()` — verifies session + org, redirects to /onboarding otherwise
- `requireRestaurantAccess(id)` — verifies membership, returns the restaurant
- `requireRestaurantBySlug(slug)` — same, resolved by URL slug

All wrappers are `React.cache()`-memoized per request.

## Port

`AuthGateway` (in `./ports.ts`). Adapters live in `./adapters/`:
- `better-auth.ts` — production (Better Auth + Drizzle)
- `client.ts` — re-export of the Better Auth React client

## Why this exists

AGENTS.md hard rule #3 says auth checks live in the data layer, not in
layouts. Every page that touches `restaurant`/`menu`/`category`/`item`
must call one of these guards close to the data fetch.
