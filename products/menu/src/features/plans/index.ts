import 'server-only'
import { cache } from 'react'
import { getPlan as fetchPlan, listRestaurants } from '../../shared/api'

/**
 * Public API of the plans slice — thin loaders over the Go menu
 * service. The Bearer token scopes both calls; the Go service is the
 * authority on entitlements AND enforces them (POST /api/restaurants
 * 422s when the plan cap is hit). What's left here is display data
 * plus a pre-flight helper so the UI can swap CTAs before the user
 * hits the server-side gate.
 */
export const getOrganizationPlan = cache(() => fetchPlan())

/**
 * Pre-flight check for the "new restaurant" CTA. Cosmetic only — the
 * Go service re-checks on create and 422s past the cap.
 */
export const canAddRestaurant = cache(async (): Promise<boolean> => {
  const [plan, { restaurants }] = await Promise.all([
    getOrganizationPlan(),
    listRestaurants(),
  ])
  return plan.restaurants === -1 || restaurants.length < plan.restaurants
})

// Display registry + pure helpers (no I/O).
export {
  DEFAULT_PLAN,
  PLANS,
  PLAN_CODES,
  REGISTRY,
  getPlanDisplay,
  isPlanCode,
  planHas,
} from './registry'
export type { PlanCode, PlanDisplay, PlanFeature } from './registry'
export type { PlanLimits } from '../../shared/api'
