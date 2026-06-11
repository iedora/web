import 'server-only'
import { getRestaurant, listRestaurants } from '../../../shared/api'

/**
 * Locate a restaurant of the caller's tenant whose post-create wizard
 * never finished (`onboardingCompletedAt` unset on the Go side).
 *
 * Used by `/menu/onboarding` to bounce a back-navigation back into
 * step 2 instead of letting the operator silently create a duplicate
 * restaurant from step 1. Returns `null` when the tenant has nothing
 * pending — the caller is free to render the "create another
 * restaurant" form.
 *
 * Tenant scoping comes from the access token (the Go service lists
 * only the caller's restaurants), so no tenantId parameter is needed.
 */
export async function findPendingOnboardingRestaurant(): Promise<{
  slug: string
} | null> {
  const { restaurants } = await listRestaurants()
  for (const summary of restaurants) {
    const { restaurant } = await getRestaurant(summary.slug)
    if (!restaurant.onboardingCompletedAt) return { slug: restaurant.slug }
  }
  return null
}
