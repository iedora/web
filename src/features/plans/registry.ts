import { plan as casaPlan } from './casa'
import { plan as freePlan } from './free'
import type { Plan, PlanCode } from './types'

/**
 * The full set of plans the app knows about. Adding a plan = new folder with
 * `index.ts` exporting `plan: Plan` + new entry here + extra literal in the
 * `PlanCode` union. The DAL, UI, and i18n consume only this registry — there
 * is no other inventory of plans elsewhere.
 */
export const REGISTRY = {
  free: freePlan,
  casa: casaPlan,
} as const satisfies Record<PlanCode, Plan>

export const PLAN_CODES = Object.keys(REGISTRY) as PlanCode[]

export const PLANS: readonly Plan[] = Object.values(REGISTRY)

export const DEFAULT_PLAN: Plan = (() => {
  const def = PLANS.find((p) => p.isDefault)
  if (!def) throw new Error('No default plan defined in registry')
  return def
})()

/**
 * Coerces any string (e.g. raw DB value) into a known plan. Unknown / null
 * values fall back to the default plan so a corrupt row never crashes a
 * server component.
 */
export function getPlan(code: string | null | undefined): Plan {
  if (code && code in REGISTRY) return REGISTRY[code as PlanCode]
  return DEFAULT_PLAN
}

export function isPlanCode(code: string): code is PlanCode {
  return code in REGISTRY
}
