import 'server-only'
import { listTenantInvoices } from '@iedora/billing'
import { PRODUCTS } from '@iedora/brand'
import type { BillingReadPort } from '../ports'
import type { PlanCode } from '../../plans'

/**
 * Production BillingReadPort. Delegates to `@iedora/billing` (which
 * owns the cross-product `core.invoice` table) filtered by
 * `product='menu'`. Year aggregation is done in-process from the
 * issued_at timestamps — the volume is tiny (years per tenant) and
 * keeping it here avoids leaking SQL grouping into the cross-product
 * helper's surface.
 *
 * Server-only — never imports the Drizzle client on the browser.
 */
export const drizzleBilling: BillingReadPort = {
  async listInvoiceYears(tenantId) {
    const invoices = await listTenantInvoices(tenantId, {
      product: PRODUCTS.menu,
    })
    const years = new Set<number>()
    for (const inv of invoices) years.add(inv.issuedAt.getUTCFullYear())
    return Array.from(years).sort((a, b) => b - a)
  },

  async listInvoicesForYear(tenantId, year) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year + 1, 0, 1))
    const invoices = await listTenantInvoices(tenantId, {
      product: PRODUCTS.menu,
      since: start,
      until: end,
    })
    return invoices.map((inv) => ({
      id: inv.id,
      plan: inv.planCode as PlanCode,
      amountCents: inv.amountCents,
      currency: inv.currency,
      status: inv.status,
      issuedAt: inv.issuedAt,
      paidAt: inv.paidAt,
    }))
  },
}
