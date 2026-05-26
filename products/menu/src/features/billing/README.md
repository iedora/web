# billing slice

Invoice reads for the dashboard billing page.

## Public API (`@/features/billing`)

- `getInvoiceYears(orgId)` — distinct years with invoices, newest first
- `getInvoicesForYear(orgId, year)` — invoices in a UTC calendar year
- `Invoice` — row shape returned to the UI

## Port + adapter

`BillingReadPort` (`./ports.ts`); production adapter is
`./adapters/drizzle.ts`. The wrappers in `index.ts` are memoized with
React's `cache()` so the billing page's parallel reads collapse to a
single DB round-trip per request.

## Why this exists

Step 10a of the vertical-slice migration. Invoices are an isolated
read surface — keeping the slice tiny avoids accidentally coupling
the future Stripe webhook writes to the read path.
