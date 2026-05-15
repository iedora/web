import 'server-only'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { auth } from './better-auth-instance'
import { db } from '@/shared/db/client'
import { member, restaurant } from '@/shared/db/schema'
import type { AuthGateway } from '../ports'

/**
 * Production AuthGateway. Wraps Better Auth (session lookup) and Drizzle
 * (membership + restaurant ownership joins). Server-only — `headers()` and
 * the Drizzle client never belong on the client.
 */
export const betterAuthGateway: AuthGateway = {
  async getSession() {
    return auth.api.getSession({ headers: await headers() })
  },

  async findEarliestOrgMembership(userId) {
    const rows = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .orderBy(member.createdAt)
      .limit(1)
    return rows[0] ?? null
  },

  async findRestaurantByIdInOrg({ restaurantId, organizationId, userId }) {
    const rows = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .innerJoin(member, eq(member.organizationId, restaurant.organizationId))
      .where(
        and(
          eq(restaurant.id, restaurantId),
          eq(restaurant.organizationId, organizationId),
          eq(member.userId, userId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },

  async findRestaurantBySlugInOrg({ slug, organizationId, userId }) {
    const rows = await db
      .select({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
      })
      .from(restaurant)
      .innerJoin(member, eq(member.organizationId, restaurant.organizationId))
      .where(
        and(
          eq(restaurant.slug, slug),
          eq(restaurant.organizationId, organizationId),
          eq(member.userId, userId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },
}
