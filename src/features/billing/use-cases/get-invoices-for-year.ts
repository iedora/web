import 'server-only'
import type { BillingReadPort } from '../ports'
import type { Invoice } from '../types'

/**
 * Invoices issued within the given calendar year, newest first. The year
 * argument is interpreted in UTC by the adapter.
 */
export async function getInvoicesForYear(
  billing: BillingReadPort,
  organizationId: string,
  year: number,
): Promise<Invoice[]> {
  return billing.listInvoicesForYear(organizationId, year)
}
