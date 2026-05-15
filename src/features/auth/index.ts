import 'server-only'
import { cache } from 'react'
import { betterAuthGateway } from './adapters/better-auth'
import { verifySession as _verifySession } from './use-cases/verify-session'
import { getEffectiveOrganizationId as _getEffectiveOrganizationId } from './use-cases/get-effective-organization-id'
import { requireActiveOrganization as _requireActiveOrganization } from './use-cases/require-active-organization'
import { requireRestaurantAccess as _requireRestaurantAccess } from './use-cases/require-restaurant-access'
import { requireRestaurantBySlug as _requireRestaurantBySlug } from './use-cases/require-restaurant-by-slug'

/**
 * Public API of the auth slice. These convenience wrappers bind the
 * production AuthGateway and are wrapped in React's `cache()` so a guard
 * called repeatedly during a single render (page + child server components)
 * hits the DB once.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `AuthGateway`.
 */
export const verifySession = cache(() => _verifySession(betterAuthGateway))

export const getEffectiveOrganizationId = cache(
  (userId: string, sessionActive: string | null | undefined) =>
    _getEffectiveOrganizationId(betterAuthGateway, userId, sessionActive),
)

export const requireActiveOrganization = cache(() =>
  _requireActiveOrganization(betterAuthGateway),
)

export const requireRestaurantAccess = cache((restaurantId: string) =>
  _requireRestaurantAccess(betterAuthGateway, restaurantId),
)

export const requireRestaurantBySlug = cache((slug: string) =>
  _requireRestaurantBySlug(betterAuthGateway, slug),
)

export type { AuthGateway } from './ports'
