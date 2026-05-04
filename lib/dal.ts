import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { member, restaurant } from './db/schema'

export const verifySession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')
  return session
})

/**
 * Resolves the user's effective organizationId.
 *
 * Better Auth doesn't restore `activeOrganizationId` after re-login, so on a
 * fresh session we fall back to the user's earliest membership. Returns null
 * only when the user truly has no organizations yet (onboarding case).
 */
export const getEffectiveOrganizationId = cache(
  async (userId: string, sessionActive: string | null | undefined): Promise<string | null> => {
    if (sessionActive) return sessionActive
    const rows = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .orderBy(member.createdAt)
      .limit(1)
    return rows[0]?.organizationId ?? null
  },
)

export const requireActiveOrganization = cache(async () => {
  const session = await verifySession()
  const organizationId = await getEffectiveOrganizationId(
    session.user.id,
    session.session.activeOrganizationId,
  )
  if (!organizationId) redirect('/onboarding')
  return { session, organizationId }
})

export const requireRestaurantAccess = cache(async (restaurantId: string) => {
  const { session, organizationId } = await requireActiveOrganization()

  const rows = await db
    .select({ id: restaurant.id })
    .from(restaurant)
    .innerJoin(member, eq(member.organizationId, restaurant.organizationId))
    .where(
      and(
        eq(restaurant.id, restaurantId),
        eq(restaurant.organizationId, organizationId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1)

  if (rows.length === 0) redirect('/dashboard')
  return { session, organizationId, restaurantId }
})
