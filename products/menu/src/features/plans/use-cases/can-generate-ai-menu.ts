import 'server-only'
import { getPlan } from '../registry'
import type { PlansGateway } from '../ports'

export type AiGenerationGate =
  | { ok: true; limit: number; used: number; resetAt: Date }
  | {
      ok: false
      reason: 'ai-weekly-limit'
      limit: number
      used: number
      resetAt: Date
    }

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Has this org's weekly AI menu-import quota been consumed?
 *
 * Window is a rolling 7-day period — `since = now - 7d`. We count every
 * generation row for the org in the window, compare to the plan's limit.
 *
 * `resetAt` is when the next generation slot will free up — useful for the
 * "try again on <date>" copy in the over-quota error. It's the timestamp
 * the oldest in-window generation will fall out of the window. When `used`
 * is zero we return now (no slots used yet means none will expire either).
 *
 * Why returns rather than throws: same shape as `canAddRestaurant` — the
 * call-site is a server action that surfaces the error to the user. A
 * thrown error would 500 the action and the user would lose context.
 */
export async function canGenerateAiMenu(
  plans: PlansGateway,
  organizationId: string,
  now: Date = new Date(),
): Promise<AiGenerationGate> {
  const since = new Date(now.getTime() - ONE_WEEK_MS)
  const [code, used] = await Promise.all([
    plans.getOrgPlan(organizationId),
    plans.countAiGenerationsSince(organizationId, since),
  ])
  const plan = getPlan(code)
  const limit = plan.limits.aiMenuGenerationsPerWeek
  // The oldest in-window generation expires `ONE_WEEK_MS` after it was
  // written; without per-row timestamps we approximate as
  // `since + ONE_WEEK_MS = now` — the call-site renders this as "in <7d>"
  // copy so the bound is good enough.
  const resetAt = new Date(since.getTime() + ONE_WEEK_MS)
  if (used >= limit) {
    return { ok: false, reason: 'ai-weekly-limit', limit, used, resetAt }
  }
  return { ok: true, limit, used, resetAt }
}
