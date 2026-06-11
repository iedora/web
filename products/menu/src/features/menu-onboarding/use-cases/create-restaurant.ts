import 'server-only'
import {
  createRestaurant,
  updateIdentity,
  type Restaurant,
} from '../../../shared/api'

/**
 * Step-1 write: provision the restaurant via the Go menu service
 * (which owns slug derivation, the plan gate — 422 on over-limit —
 * and auditing), then persist the optional tagline as the public
 * description. The tagline write is best-effort: a failure must not
 * strand the operator between steps, they can re-enter it later from
 * the identity settings.
 */
export async function createOnboardingRestaurant(input: {
  name: string
  defaultLanguage: string
  tagline?: string
}): Promise<Restaurant> {
  const restaurant = await createRestaurant(input.name, input.defaultLanguage)
  if (input.tagline) {
    try {
      await updateIdentity(restaurant.slug, { description: input.tagline })
    } catch (err) {
      console.error('[menu-onboarding] tagline save failed', err)
    }
  }
  return restaurant
}
