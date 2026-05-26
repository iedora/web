import 'server-only'
import type { BillingReadPort } from '../ports'

/**
 * Years with at least one invoice for the org, newest first. The billing page
 * uses this to render the year filter chips — never hardcode the current
 * year, the UI should follow what's actually billed.
 */
export async function getInvoiceYears(
  billing: BillingReadPort,
  organizationId: string,
): Promise<number[]> {
  return billing.listInvoiceYears(organizationId)
}
