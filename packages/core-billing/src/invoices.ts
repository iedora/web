import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { getCoreDb, recordAudit } from '@iedora/core-auth'
import type { ProductId } from '@iedora/brand'

import { schema } from './schema'
import {
  type InvoiceStatus,
  type Currency,
  BILLING_AUDIT_EVENTS,
  DEFAULT_CURRENCY,
} from './literals'

/**
 * Invoice ledger primitives. Append-only by convention — no `update`
 * helper that mutates random columns. Status transitions go through
 * `markInvoicePaid` / `voidInvoice` so the audit trail names the
 * event explicitly.
 *
 * `planCode` is snapshotted at issuance — survives a rename or
 * removal of the plan in code without rewriting history.
 */

const { invoice } = schema

export type Invoice = typeof invoice.$inferSelect

export type RecordInvoiceInput = {
  tenantId: string
  product: ProductId
  amountCents: number
  currency?: Currency
  /** Plan code at the moment of issuance — snapshot. */
  planCode: string
  status?: InvoiceStatus
  issuedAt?: Date
  stripeInvoiceId?: string | null
  actor: { userId: string; email?: string | null }
}

export async function recordInvoice(
  input: RecordInvoiceInput,
): Promise<Invoice> {
  const db = getCoreDb()
  const id = randomUUID()
  const now = new Date()
  const [row] = await db
    .insert(invoice)
    .values({
      id,
      tenantId: input.tenantId,
      product: input.product,
      amountCents: input.amountCents,
      currency: input.currency ?? DEFAULT_CURRENCY,
      status: input.status ?? 'open',
      planCode: input.planCode,
      issuedAt: input.issuedAt ?? now,
      stripeInvoiceId: input.stripeInvoiceId ?? null,
      createdAt: now,
    })
    .returning()
  if (!row) throw new Error('[iedora/billing] recordInvoice returned no row')

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.INVOICE_RECORDED,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: input.tenantId },
    meta: {
      invoiceId: id,
      product: input.product,
      planCode: input.planCode,
      amountCents: input.amountCents,
      currency: input.currency ?? DEFAULT_CURRENCY,
      status: input.status ?? 'open',
    },
    important: true,
  })

  return row
}

export async function markInvoicePaid(input: {
  invoiceId: string
  paidAt?: Date
  actor: { userId: string; email?: string | null }
}): Promise<Invoice | null> {
  const db = getCoreDb()
  const paidAt = input.paidAt ?? new Date()
  const [row] = await db
    .update(invoice)
    .set({ status: 'paid', paidAt })
    .where(eq(invoice.id, input.invoiceId))
    .returning()
  if (!row) return null

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.INVOICE_PAID,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: row.tenantId },
    meta: { invoiceId: row.id, product: row.product, paidAt: paidAt.toISOString() },
    important: true,
  })
  return row
}

export async function voidInvoice(input: {
  invoiceId: string
  reason?: string
  actor: { userId: string; email?: string | null }
}): Promise<Invoice | null> {
  const db = getCoreDb()
  const [row] = await db
    .update(invoice)
    .set({ status: 'void' })
    .where(eq(invoice.id, input.invoiceId))
    .returning()
  if (!row) return null

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.INVOICE_VOIDED,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: row.tenantId },
    meta: {
      invoiceId: row.id,
      product: row.product,
      reason: input.reason ?? null,
    },
    important: true,
  })
  return row
}

// ─── Reads ─────────────────────────────────────────────────────────

export type ListInvoicesFilter = {
  product?: ProductId
  status?: InvoiceStatus
  /** Inclusive issued-at lower bound. */
  since?: Date
  /** Inclusive issued-at upper bound. */
  until?: Date
  limit?: number
}

export async function listTenantInvoices(
  tenantId: string,
  filter: ListInvoicesFilter = {},
): Promise<Invoice[]> {
  const db = getCoreDb()
  const conditions = [eq(invoice.tenantId, tenantId)]
  if (filter.product) conditions.push(eq(invoice.product, filter.product))
  if (filter.status) conditions.push(eq(invoice.status, filter.status))
  if (filter.since) conditions.push(gte(invoice.issuedAt, filter.since))
  if (filter.until) conditions.push(lte(invoice.issuedAt, filter.until))

  return db
    .select()
    .from(invoice)
    .where(and(...conditions))
    .orderBy(desc(invoice.issuedAt))
    .limit(Math.min(filter.limit ?? 100, 500))
}

export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  const db = getCoreDb()
  const rows = await db
    .select()
    .from(invoice)
    .where(eq(invoice.id, invoiceId))
    .limit(1)
  return rows[0] ?? null
}
