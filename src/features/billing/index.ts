import 'server-only'
import { cache } from 'react'
import { drizzleBilling } from './adapters/drizzle'
import { getInvoiceYears as _getInvoiceYears } from './use-cases/get-invoice-years'
import { getInvoicesForYear as _getInvoicesForYear } from './use-cases/get-invoices-for-year'

/**
 * Public API of the billing slice. These convenience wrappers bind the
 * production BillingReadPort and are wrapped in React's `cache()` so the
 * billing page can call them in parallel without hitting the DB twice.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `BillingReadPort`.
 */
export const getInvoiceYears = cache((organizationId: string) =>
  _getInvoiceYears(drizzleBilling, organizationId),
)

export const getInvoicesForYear = cache(
  (organizationId: string, year: number) =>
    _getInvoicesForYear(drizzleBilling, organizationId, year),
)

export type { Invoice } from './types'
export type { BillingReadPort } from './ports'
