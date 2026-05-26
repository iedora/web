import type { Invoice } from './types'

/**
 * BillingReadPort — the slice's only dependency on the outside world.
 *
 * Use-cases call methods on this interface; production wires it to
 * `drizzleBilling` (Drizzle + Postgres). Tests can swap in fakes.
 *
 * Keep this surface minimal: just the reads the billing page needs.
 */
export interface BillingReadPort {
  /**
   * Distinct years (newest first) for which the organization has at least one
   * invoice. Drives the year filter chips on the billing page — never
   * hardcode the current year, the UI follows what's actually billed.
   */
  listInvoiceYears(organizationId: string): Promise<number[]>

  /**
   * Invoices issued within the given calendar year, newest first. The year is
   * interpreted in UTC so the range matches the DB's `timestamp` columns.
   */
  listInvoicesForYear(
    organizationId: string,
    year: number,
  ): Promise<Invoice[]>
}
