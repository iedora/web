import 'server-only'
import { isPlanCode } from '../registry'
import type { PlansGateway } from '../ports'
import type { PlanCode } from '../types'

export type SetOrganizationPlanResult =
  | { ok: true; plan: PlanCode }
  | { error: 'unknown-plan' | 'not-found' }

/**
 * Switches the active organization to a target plan. No payment yet — this
 * is the placeholder that the eventual Stripe flow will call once a checkout
 * session settles. We re-validate the code against the registry; the caller
 * is responsible for authenticating the user and resolving the org id.
 */
export async function setOrganizationPlan(
  plans: PlansGateway,
  organizationId: string,
  target: string,
): Promise<SetOrganizationPlanResult> {
  if (!isPlanCode(target)) return { error: 'unknown-plan' }
  const ok = await plans.updateOrgPlan(organizationId, target)
  if (!ok) return { error: 'not-found' }
  return { ok: true, plan: target }
}
