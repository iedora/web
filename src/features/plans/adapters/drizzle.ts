import 'server-only'
import { count, eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { organization, restaurant } from '@/shared/db/schema'
import type { PlansGateway } from '../ports'

/**
 * Production PlansGateway. Wraps Drizzle reads/writes against the
 * `organization` and `restaurant` tables. Server-only — the Drizzle client
 * never belongs on the client.
 */
export const drizzlePlans: PlansGateway = {
  async getOrgPlan(organizationId) {
    const rows = await db
      .select({ plan: organization.plan })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    return rows[0]?.plan ?? null
  },

  async countOrgRestaurants(organizationId) {
    const rows = await db
      .select({ value: count() })
      .from(restaurant)
      .where(eq(restaurant.organizationId, organizationId))
    return Number(rows[0]?.value ?? 0)
  },

  async updateOrgPlan(organizationId, code) {
    const res = await db
      .update(organization)
      .set({ plan: code })
      .where(eq(organization.id, organizationId))
    // postgres-js exposes the row count on `.count`; older drivers used
    // `.rowCount`. Check both so we don't silently report success when the
    // org didn't exist.
    const r = res as { rowCount?: number; count?: number }
    return (r.rowCount ?? r.count ?? 0) > 0
  },
}
