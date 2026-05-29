import 'server-only'
import { and, desc, eq, ilike, isNotNull, or } from 'drizzle-orm'
import { getCoreDb, schema } from '@iedora/auth'
import type {
  AdminSessionRow,
  AdminSessionsGateway,
  ListAllSessionsInput,
} from '../ports'

/**
 * Cross-tenant sessions admin gateway. Used to plumb through better-
 * auth's admin plugin (`auth.api.listUsers` + `listUserSessions`);
 * after the tenancy refactor the plugin was dropped, so we read
 * sessions + users directly via Drizzle. Same shape, single round-
 * trip per page (one JOIN instead of N per-user fetches).
 */
export function betterAuthAdminSessionsGateway(): AdminSessionsGateway {
  return {
    async listAllSessions(input: ListAllSessionsInput) {
      const db = getCoreDb()
      const limit = input.userLimit ?? 500
      const conditions = []
      if (input.q) {
        const q = `%${input.q}%`
        conditions.push(or(ilike(schema.user.email, q), ilike(schema.user.name, q))!)
      }
      if (input.impersonatedOnly) {
        conditions.push(isNotNull(schema.session.impersonatedBy))
      }

      const rows = await db
        .select({
          id: schema.session.id,
          token: schema.session.token,
          userId: schema.user.id,
          userEmail: schema.user.email,
          userName: schema.user.name,
          ipAddress: schema.session.ipAddress,
          userAgent: schema.session.userAgent,
          createdAt: schema.session.createdAt,
          expiresAt: schema.session.expiresAt,
          impersonatedBy: schema.session.impersonatedBy,
        })
        .from(schema.session)
        .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.session.createdAt))
        .limit(limit)

      const out: AdminSessionRow[] = rows.map((r) => ({
        id: r.id,
        token: r.token,
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        ipAddress: r.ipAddress ?? null,
        userAgent: r.userAgent ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        impersonatedBy: r.impersonatedBy ?? null,
      }))
      return out
    },

    async revokeSession({ sessionToken }) {
      const db = getCoreDb()
      await db
        .delete(schema.session)
        .where(eq(schema.session.token, sessionToken))
    },
  }
}
