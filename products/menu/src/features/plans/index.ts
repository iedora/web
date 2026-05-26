import 'server-only'
import { cache } from 'react'
import { drizzlePlans } from './adapters/drizzle'
import { canAddRestaurant as _canAddRestaurant } from './use-cases/can-add-restaurant'
import { canGenerateAiMenu as _canGenerateAiMenu } from './use-cases/can-generate-ai-menu'
import { getOrganizationPlan as _getOrganizationPlan } from './use-cases/get-organization-plan'
import { getOrganizationRestaurantCount as _getOrganizationRestaurantCount } from './use-cases/get-organization-restaurant-count'
import { recordAiGeneration as _recordAiGeneration } from './use-cases/record-ai-generation'

/**
 * Public API of the plans slice. These convenience wrappers bind the
 * production PlansGateway and are wrapped in React's `cache()` so a gate
 * called repeatedly during a single render (page component + server actions
 * called within) hits the DB once.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `PlansGateway`.
 */
export const getOrganizationPlan = cache((organizationId: string) =>
  _getOrganizationPlan(drizzlePlans, organizationId),
)

export const getOrganizationRestaurantCount = cache((organizationId: string) =>
  _getOrganizationRestaurantCount(drizzlePlans, organizationId),
)

export const canAddRestaurant = (organizationId: string) =>
  _canAddRestaurant(drizzlePlans, organizationId)

export const canGenerateAiMenu = (organizationId: string) =>
  _canGenerateAiMenu(drizzlePlans, organizationId)

export const recordAiGeneration = (organizationId: string) =>
  _recordAiGeneration(drizzlePlans, organizationId)

// Pure helpers (no I/O) re-exported directly.
export { planHas } from './use-cases/plan-has'
export type { RestaurantGate } from './use-cases/can-add-restaurant'
export type { AiGenerationGate } from './use-cases/can-generate-ai-menu'

// Registry + types — pure data, safe everywhere.
export {
  DEFAULT_PLAN,
  PLANS,
  PLAN_CODES,
  REGISTRY,
  getPlan,
  isPlanCode,
} from './registry'
export type { Plan, PlanCode, PlanFeature, PlanLimits } from './types'
export type { PlansGateway } from './ports'
