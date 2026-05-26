import 'server-only'
import { getPlan } from '../registry'
import type { PlansGateway } from '../ports'
import type { Plan } from '../types'

/**
 * Resolves an organization's current plan. The gateway returns the raw text
 * stored in the DB; `getPlan` coerces unknown / null values back to the
 * default plan so a corrupt or renamed code never crashes a render.
 */
export async function getOrganizationPlan(
  plans: PlansGateway,
  organizationId: string,
): Promise<Plan> {
  const code = await plans.getOrgPlan(organizationId)
  return getPlan(code)
}
