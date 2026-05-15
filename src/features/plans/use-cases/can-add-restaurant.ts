import 'server-only'
import { getPlan } from '../registry'
import type { PlansGateway } from '../ports'

export type RestaurantGate =
  | { ok: true }
  | { ok: false; reason: 'restaurant-limit'; limit: number; current: number }

/**
 * Why this returns rather than throws: the call site is a form action that
 * surfaces the error as inline copy ("upgrade to add more"). A thrown error
 * would 500 the action and the user would lose context.
 */
export async function canAddRestaurant(
  plans: PlansGateway,
  organizationId: string,
): Promise<RestaurantGate> {
  const [code, current] = await Promise.all([
    plans.getOrgPlan(organizationId),
    plans.countOrgRestaurants(organizationId),
  ])
  const plan = getPlan(code)
  if (current >= plan.limits.restaurants) {
    return {
      ok: false,
      reason: 'restaurant-limit',
      limit: plan.limits.restaurants,
      current,
    }
  }
  return { ok: true }
}
