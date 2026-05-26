import 'server-only'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { invoice } from '@/shared/db/schema'
import type { BillingReadPort } from '../ports'

/**
 * Production BillingReadPort. Wraps Drizzle reads against the `invoice`
 * table. Server-only — the Drizzle client never belongs on the client.
 */
export const drizzleBilling: BillingReadPort = {
  async listInvoiceYears(organizationId) {
    // Postgres requires SELECT DISTINCT's ORDER BY expressions to match
    // exactly one of the select-list expressions; binding the year extract to
    // a single `sql` fragment ensures cast and sort agree on identity.
    const yearExpr = sql<number>`extract(year from ${invoice.issuedAt})::int`
    const rows = await db
      .selectDistinct({ year: yearExpr })
      .from(invoice)
      .where(eq(invoice.organizationId, organizationId))
      .orderBy(desc(yearExpr))
    return rows.map((r) => Number(r.year))
  },

  async listInvoicesForYear(organizationId, year) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year + 1, 0, 1))
    const rows = await db
      .select()
      .from(invoice)
      .where(
        and(
          eq(invoice.organizationId, organizationId),
          gte(invoice.issuedAt, start),
          lt(invoice.issuedAt, end),
        ),
      )
      .orderBy(desc(invoice.issuedAt))
    return rows.map((r) => ({
      id: r.id,
      plan: r.plan,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      issuedAt: r.issuedAt,
      paidAt: r.paidAt,
    }))
  },
}
