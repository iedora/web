import type { Plan, PlanFeature } from '../types'

/**
 * Pure predicate — no I/O, no `server-only`. Safe to import on the client
 * once a `Plan` is in hand (server components pass it through props).
 */
export function planHas(plan: Plan, feature: PlanFeature): boolean {
  return plan.features.has(feature)
}
