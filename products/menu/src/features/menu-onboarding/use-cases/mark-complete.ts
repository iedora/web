import 'server-only'
import { completeOnboarding } from '../../../shared/api'

/**
 * Flip the restaurant's onboarding-completed flag via the Go menu
 * service. Idempotent — re-running on an already-completed restaurant
 * simply re-stamps the timestamp, which is harmless. Tenancy and
 * ownership are enforced by the Go service through the caller's
 * Bearer token; a foreign or unknown slug 404s there.
 */
export async function markRestaurantOnboardingComplete(
  slug: string,
): Promise<void> {
  await completeOnboarding(slug)
}
