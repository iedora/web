'use server'

import { revalidatePath } from 'next/cache'
import { requireActiveOrganization } from '@/features/auth'
import { drizzlePlans } from './adapters/drizzle'
import { setOrganizationPlan as run } from './use-cases/set-organization-plan'
import type { PlanCode } from './types'

/**
 * Server action shell — authenticates the caller, resolves the active org,
 * then delegates to the use-case with the production adapter. Keep this thin
 * so the testable surface stays in `use-cases/set-organization-plan.ts`.
 */
export async function setOrganizationPlan(target: PlanCode) {
  const { organizationId } = await requireActiveOrganization()
  const result = await run(drizzlePlans, organizationId, target)
  if ('error' in result) {
    return { error: 'Unknown plan' as const }
  }
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/billing')
  return { ok: true as const, plan: result.plan }
}
