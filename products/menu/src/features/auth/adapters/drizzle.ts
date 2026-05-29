import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../shared/db/client'
import { restaurant } from '../../../shared/db/schema'
import { getSession as getCoreSession, getActiveTenantId } from '@iedora/auth/server'
import type { AuthGateway, Session } from '../ports'

/**
 * Production AuthGateway. Delegates session reads to `@iedora/auth/
 * server.getSession()` (better-auth under the hood) and active-tenant
 * resolution to `getActiveTenantId()` which lazily revalidates the
 * stored `session.active_tenant_id` against `tenant_member`.
 *
 * Server-only: the Next-aware helpers + Drizzle client never belong
 * on the client.
 */
async function readSession(): Promise<Session | null> {
  const s = await getCoreSession()
  if (!s?.user) return null

  const activeTenantId = await getActiveTenantId({
    sessionId: s.session.id,
    userId: s.user.id,
  })

  return {
    user: {
      id: s.user.id,
      email: s.user.email,
      name: s.user.name,
      scopes: (s.user as { scopes?: string[] | null }).scopes ?? null,
    },
    session: {
      id: s.session.id,
      activeTenantId,
    },
  }
}

export const drizzleAuthGateway: AuthGateway = {
  getSession: readSession,

  async findRestaurantByIdInOrg({ restaurantId, tenantId }) {
    const rows = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .where(
        and(
          eq(restaurant.id, restaurantId),
          eq(restaurant.tenantId, tenantId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },

  async findRestaurantBySlugInOrg({ slug, tenantId }) {
    const rows = await db
      .select({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
      })
      .from(restaurant)
      .where(
        and(
          eq(restaurant.slug, slug),
          eq(restaurant.tenantId, tenantId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },
}
