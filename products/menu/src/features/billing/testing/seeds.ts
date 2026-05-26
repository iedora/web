import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'
import type { PlanCode } from '@/features/plans'

export type SeedInvoiceInput = {
  organizationId: string
  plan: PlanCode
  amountCents: number
  currency?: string
  status?: 'paid' | 'pending' | 'void'
  periodStart?: Date
  periodEnd?: Date
}

export type SeededInvoice = {
  invoiceId: string
  organizationId: string
  amountCents: number
}

export async function seedInvoice(input: SeedInvoiceInput): Promise<SeededInvoice> {
  const sql = testDb()
  const now = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."invoice" (
      id, organization_id, plan, period_start, period_end,
      amount_cents, currency, status, issued_at,
      paid_at
    ) VALUES (
      gen_random_uuid()::text,
      ${input.organizationId},
      ${input.plan},
      ${input.periodStart ?? monthAgo},
      ${input.periodEnd ?? now},
      ${input.amountCents},
      ${input.currency ?? 'EUR'},
      ${input.status ?? 'paid'},
      now(),
      ${input.status === 'paid' || !input.status ? now : null}
    )
    RETURNING id
  `
  return {
    invoiceId: row!.id,
    organizationId: input.organizationId,
    amountCents: input.amountCents,
  }
}
