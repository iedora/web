import 'server-only'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import { auth } from '@iedora/auth'
import type { AuthGateway, Session } from '../ports'

/**
 * Production AuthGateway. Delegates session reads to better-auth (which
 * owns the cookie + the server-side row in the `core` schema) and
 * resolves restaurant lookups against the menu DB.
 *
 * Server-only: the `headers()` call and the Drizzle client never belong
 * on the client.
 */
async function readSession(): Promise<Session | null> {
  const s = await auth.api.getSession({ headers: await headers() })
  if (!s?.user) return null

  const role = s.user.role ?? null
  return {
    user: {
      id: s.user.id,
      email: s.user.email,
      name: s.user.name,
      role,
      // Back-compat shim — the previous Zitadel implementation surfaced
      // `roles` as an array. With better-auth, the cross-tenant role is
      // a scalar (`user.role`); we project it into a single-element
      // array so consumers calling `.roles.includes('iedora-admin')`
      // keep working without changes.
      roles: role ? [role] : [],
      // Always empty — granular per-resource checks go through
      // `requireScope()` (which calls `auth.api.hasPermission`), not
      // through a flat list on the session.
      permissions: [],
    },
    session: {
      id: s.session.id,
      activeOrganizationId: s.session.activeOrganizationId ?? null,
    },
    sid: s.session.id,
    expiresAt: Math.floor(new Date(s.session.expiresAt).getTime() / 1000),
  }
}

export const drizzleAuthGateway: AuthGateway = {
  getSession: readSession,

  async findRestaurantByIdInOrg({ restaurantId, organizationId }) {
    const rows = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .where(
        and(
          eq(restaurant.id, restaurantId),
          eq(restaurant.organizationId, organizationId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },

  async findRestaurantBySlugInOrg({ slug, organizationId }) {
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
          eq(restaurant.organizationId, organizationId),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },
}
