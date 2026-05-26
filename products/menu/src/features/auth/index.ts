import 'server-only'
import { cache } from 'react'
import { drizzleAuthGateway } from './adapters/drizzle'
import { verifySession as _verifySession } from './use-cases/verify-session'
import { getEffectiveOrganizationId as _getEffectiveOrganizationId } from './use-cases/get-effective-organization-id'
import { requireActiveOrganization as _requireActiveOrganization } from './use-cases/require-active-organization'
import { requireRestaurantAccess as _requireRestaurantAccess } from './use-cases/require-restaurant-access'
import { requireRestaurantBySlug as _requireRestaurantBySlug } from './use-cases/require-restaurant-by-slug'
import { requireIedoraAdmin as _requireIedoraAdmin } from './use-cases/require-iedora-admin'
import { requireScope as _requireScope } from './use-cases/require-scope'
import type { Scope } from './scopes'

/**
 * Public API of the auth slice. Convenience wrappers bind the production
 * AuthGateway (better-auth session + Drizzle restaurant lookup) and wrap
 * each call in React's `cache()` so a guard called repeatedly during a
 * single render hits the wire once.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `AuthGateway`.
 */

/**
 * Non-redirecting read of the session. Returns null when there's no
 * cookie / it's expired. Use for chrome that should render signed-in
 * vs signed-out without forcing a redirect (dashboard layout, public
 * landing). Real gating uses `verifySession()` / `requireRestaurantAccess()`
 * close to the data fetch — layouts in Next 16 don't re-render on
 * navigation, so `redirect()` in a layout would leak across pages.
 */
export const getSession = cache(() => drizzleAuthGateway.getSession())

export const verifySession = cache(() => _verifySession(drizzleAuthGateway))

/**
 * Legacy signature kept for back-compat — the `_userId` argument is
 * unused; the active org now lives on the better-auth session row and
 * the lookup is a single read. Callers can drop the arg over time.
 */
export const getEffectiveOrganizationId = cache((_userId?: string) =>
  _getEffectiveOrganizationId(drizzleAuthGateway),
)

export const requireActiveOrganization = cache(() =>
  _requireActiveOrganization(drizzleAuthGateway),
)

export const requireRestaurantAccess = cache((restaurantId: string) =>
  _requireRestaurantAccess(drizzleAuthGateway, restaurantId),
)

export const requireRestaurantBySlug = cache((slug: string) =>
  _requireRestaurantBySlug(drizzleAuthGateway, slug),
)

/**
 * Cross-tenant guard. Requires the user's cross-tenant `role` to be
 * `iedora-admin`. Use for staff-only surfaces and legacy call sites.
 * New surfaces should reach for `requireScope(scope)` — fine-grained,
 * capability-based, AC-backed.
 */
export const requireIedoraAdmin = cache(() => _requireIedoraAdmin(drizzleAuthGateway))

/**
 * Capability-based guard. Resolves the caller's permissions through
 * better-auth's organization plugin (per-org `member.role` evaluated
 * against the @iedora/auth statement). `iedora-admin` short-circuits to
 * allowed.
 */
export const requireScope = cache((scope: Scope) =>
  _requireScope(drizzleAuthGateway, scope),
)

export type { AuthGateway, Session } from './ports'
export { IEDORA_ADMIN_ROLE } from './roles'
export { SCOPES, type Scope, scopeToPermission } from './scopes'
export { BUNDLES } from './bundles'
