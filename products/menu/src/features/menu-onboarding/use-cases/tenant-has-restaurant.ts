import 'server-only'
import { listRestaurants } from '../../../shared/api'

/**
 * Fast yes/no — does the caller's tenant own at least one restaurant,
 * regardless of onboarding state. Used by `/menu/onboarding` to
 * decide whether the page is a legitimate first-time landing
 * (tenant has zero) or a navigation slip (tenant has restaurants,
 * route should bounce to the dashboard).
 *
 * Tenant scoping comes from the access token, so no tenantId
 * parameter is needed.
 */
export async function tenantHasRestaurant(): Promise<boolean> {
  const { restaurants } = await listRestaurants()
  return restaurants.length > 0
}
