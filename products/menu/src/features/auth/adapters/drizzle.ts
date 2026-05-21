import 'server-only'
import { cookies } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import { env } from '@/shared/env'
import { sessionStore } from '@/features/sessions'
import type { AuthGateway } from '../ports'
import {
  makeSessionCookie,
  SESSION_COOKIE,
  type Session,
} from './session'

/**
 * Production AuthGateway. Wraps the menu session cookie (jose JWE → opaque
 * pointer) + the server-side session store + Drizzle (restaurant lookup
 * scoped to a tenant id). Tenant-membership checks run against Zitadel
 * via `@/features/identity` — see the use-cases.
 *
 * Server-only: `cookies()` and the Drizzle client never belong on the client.
 */
const sessions = makeSessionCookie(env.MENU_SESSION_SECRET)

async function readSessionCookie(): Promise<Session | null> {
  const jar = await cookies()
  const raw = jar.get(SESSION_COOKIE)?.value
  if (!raw) return null

  const pointer = await sessions.open(raw)
  if (!pointer) return null

  // Authoritative lookup. The store rejects revoked + expired rows, so a
  // grant-change webhook or admin revoke takes effect on the very next
  // request — no waiting on the 7d cookie TTL.
  const record = await sessionStore.get(pointer.sid)
  if (!record) return null

  // Cheap tamper check: cookie's `sub` must match the row's `userId`. The
  // JWE already authenticates the payload (A256GCM), but a mismatch here
  // would catch a server-side row swap and is a free invariant to assert.
  if (record.userId !== pointer.sub) return null

  return {
    user: {
      id: record.userId,
      email: record.email,
      name: record.name,
      roles: record.roles,
      permissions: record.permissions,
    },
    expiresAt: Math.floor(record.expiresAt.getTime() / 1000),
    sid: record.id,
  }
}

export const drizzleAuthGateway: AuthGateway = {
  getSession: readSessionCookie,

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
