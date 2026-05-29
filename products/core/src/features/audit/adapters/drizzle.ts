import 'server-only'
import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { getCoreDb, schema } from '@iedora/auth'
import type { AuditEntry, AuditGateway, ListAuditInput } from '../ports'

/**
 * Drizzle adapter for the audit-log read path. Queries the
 * `core.audit_log` table (declared in `@iedora/auth/schema`) directly
 * — there's no better-auth API for this; the table is iedora-owned
 * append-only state.
 */
export function drizzleAuditGateway(): AuditGateway {
  return {
    async list(input: ListAuditInput) {
      const db = getCoreDb()
      const page = Math.max(1, Math.floor(input.page))
      const pageSize = Math.max(1, Math.min(200, Math.floor(input.pageSize)))
      const offset = (page - 1) * pageSize

      const conditions = []
      if (input.event) {
        conditions.push(ilike(schema.auditLog.event, `${input.event}%`))
      }
      if (input.actorEmail) {
        conditions.push(
          ilike(schema.auditLog.actorEmail, `%${input.actorEmail}%`),
        )
      }
      if (input.targetUserId) {
        conditions.push(eq(schema.auditLog.targetUserId, input.targetUserId))
      }
      if (input.targetTenantId) {
        conditions.push(eq(schema.auditLog.targetTenantId, input.targetTenantId))
      }
      if (input.importantOnly) {
        conditions.push(eq(schema.auditLog.important, true))
      }
      const where = conditions.length ? and(...conditions) : undefined

      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(schema.auditLog)
          .where(where)
          .orderBy(desc(schema.auditLog.at))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.auditLog)
          .where(where),
      ])

      const entries: AuditEntry[] = rows.map((r) => ({
        id: r.id,
        at: r.at,
        event: r.event,
        outcome: r.outcome,
        actorUserId: r.actorUserId,
        actorRole: r.actorRole,
        actorEmail: r.actorEmail,
        targetUserId: r.targetUserId,
        targetTenantId: r.targetTenantId,
        targetSessionId: r.targetSessionId,
        ipHash: r.ipHash,
        userAgent: r.userAgent,
        requestPath: r.requestPath,
        meta: (r.meta as Record<string, unknown> | null) ?? null,
        important: r.important,
      }))

      return {
        entries,
        total: totalRow[0]?.n ?? entries.length,
        page,
        pageSize,
      }
    },
  }
}
