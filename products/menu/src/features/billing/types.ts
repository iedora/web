import type { InvoiceStatus } from '@iedora/core-billing'
import type { PlanCode } from '../plans'

/**
 * Invoice shape returned by the slice. Mirrors the columns the billing
 * page renders; not a 1:1 echo of the cross-product `core.invoice` row
 * (managed by `@iedora/core-billing`) so we can evolve the schema without
 * leaking columns into the UI.
 *
 * `plan` is menu's `PlanCode` (`'free'` / `'casa'`); we cast on the
 * way out of `@iedora/core-billing` (which stores it as an opaque string
 * keyed per product). Period fields don't exist in the new schema
 * (Stripe-shape pulled them onto the subscription, not the invoice);
 * derive from issuedAt + plan period when needed for display.
 */
export type Invoice = {
  id: string
  plan: PlanCode
  amountCents: number
  currency: string
  status: InvoiceStatus
  issuedAt: Date
  paidAt: Date | null
}
