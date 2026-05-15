import type { InvoiceStatus } from '@/shared/db/schema'
import type { PlanCode } from '@/features/plans'

/**
 * Invoice shape returned by the slice. Mirrors the columns the billing page
 * renders; not a 1:1 echo of the DB row so we can evolve the schema without
 * leaking columns into the UI.
 */
export type Invoice = {
  id: string
  plan: PlanCode
  periodStart: Date
  periodEnd: Date
  amountCents: number
  currency: string
  status: InvoiceStatus
  issuedAt: Date
  paidAt: Date | null
}
