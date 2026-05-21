import 'server-only'
import { cache } from 'react'
import { zitadelHttpIdentity } from '@/features/identity'
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
 * Public API of the auth slice. These convenience wrappers bind the
 * production AuthGateway (encrypted session cookie + Drizzle) AND the
 * IdentityGateway (Zitadel management API), wrapped in React's `cache()`
 * so a guard called repeatedly during a single render hits the wire once.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass fake `AuthGateway` + `IdentityGateway`.
 */

/**
 * Non-redirecting read of the menu session. Returns null when there's no
 * cookie / it's expired / tampered. Use for chrome that should render
 * the signed-in or signed-out variant without forcing a redirect (e.g.
 * dashboard layout, public landing).
 *
 * Layouts in Next 16 don't re-render on navigation — `redirect()` here
 * would leak across pages. Real gating uses `verifySession()` /
 * `requireRestaurantAccess()` close to the data fetch.
 */
export const getSession = cache(() => drizzleAuthGateway.getSession())

export const verifySession = cache(() => _verifySession(drizzleAuthGateway))

export const getEffectiveOrganizationId = cache((userId: string) =>
  _getEffectiveOrganizationId(zitadelHttpIdentity, userId),
)

export const requireActiveOrganization = cache(() =>
  _requireActiveOrganization(drizzleAuthGateway, zitadelHttpIdentity),
)

export const requireRestaurantAccess = cache((restaurantId: string) =>
  _requireRestaurantAccess(drizzleAuthGateway, zitadelHttpIdentity, restaurantId),
)

export const requireRestaurantBySlug = cache((slug: string) =>
  _requireRestaurantBySlug(drizzleAuthGateway, zitadelHttpIdentity, slug),
)

/**
 * Cross-tenant guard. Requires `iedora-admin` project role (granted via
 * Zitadel on the iedora project). Use for chrome decisions and legacy
 * call-sites. New surfaces should reach for `requireScope(scope)` —
 * fine-grained, capability-based, future-proof.
 */
export const requireIedoraAdmin = cache(() => _requireIedoraAdmin(drizzleAuthGateway))

/**
 * Capability-based guard. Authoritative for cross-tenant admin
 * surfaces — checks `session.user.permissions` (the flat scope list
 * injected by the Zitadel Actions v2 webhook). Bundles like
 * `iedora-admin` resolve to a set of these scopes; per-user atomic
 * grants top them up.
 */
export const requireScope = cache((scope: Scope) =>
  _requireScope(drizzleAuthGateway, scope),
)

export type { AuthGateway, Session } from './ports'
export { IEDORA_ADMIN_ROLE } from './roles'
export { SCOPES, type Scope } from './scopes'
