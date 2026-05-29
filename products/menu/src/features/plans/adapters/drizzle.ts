import 'server-only'
import { and, count, eq, gt } from 'drizzle-orm'
import { db } from '../../../shared/db/client'
import { aiMenuGeneration, restaurant } from '../../../shared/db/schema'
import {
  getSubscription,
  createSubscription,
  updateSubscription,
} from '@iedora/core-billing'
import { PRODUCTS } from '@iedora/brand'
import type { PlansGateway } from '../ports'
import type { PlanCode } from '../types'

/**
 * Production PlansGateway. Plan code is now stored in
 * `core.tenant_subscription` keyed by `(tenantId, product='menu')`
 * via `@iedora/core-billing`. Menu's PlansGateway acts as a thin adapter
 * that:
 *   - reads the plan code from the cross-product subscription helper
 *     and CASTs it to menu's local `PlanCode` (the registry coerces
 *     unknowns back to the default at read time);
 *   - keeps the AI-generations + restaurant-count counters local
 *     (menu-domain data; no reason for those to live in core).
 *
 * Write helpers (`updateOrgPlan`) upsert through
 * `getSubscription` / `createSubscription` / `updateSubscription` so
 * the audit log captures the change at the cross-product boundary.
 *
 * Server-only — the Drizzle client + billing helpers never belong
 * on the client.
 */
export const drizzlePlans: PlansGateway = {
  async getOrgPlan(tenantId) {
    const sub = await getSubscription(tenantId, PRODUCTS.menu)
    if (!sub) return null
    return sub.plan as PlanCode
  },

  async countOrgRestaurants(tenantId) {
    const rows = await db
      .select({ value: count() })
      .from(restaurant)
      .where(eq(restaurant.tenantId, tenantId))
    return Number(rows[0]?.value ?? 0)
  },

  async updateOrgPlan(tenantId, code, actor) {
    const sub = await getSubscription(tenantId, PRODUCTS.menu)
    const actorInfo = actor ?? { userId: 'system', email: null }
    if (sub) {
      await updateSubscription({
        subscriptionId: sub.id,
        plan: code,
        actor: actorInfo,
      })
    } else {
      await createSubscription({
        tenantId,
        product: PRODUCTS.menu,
        plan: code,
        status: 'active',
        actor: actorInfo,
      })
    }
    return true
  },

  async countAiGenerationsSince(tenantId, since) {
    const rows = await db
      .select({ value: count() })
      .from(aiMenuGeneration)
      .where(
        and(
          eq(aiMenuGeneration.tenantId, tenantId),
          gt(aiMenuGeneration.createdAt, since),
        ),
      )
    return Number(rows[0]?.value ?? 0)
  },

  async recordAiGeneration(tenantId) {
    await db.insert(aiMenuGeneration).values({ tenantId })
  },
}
