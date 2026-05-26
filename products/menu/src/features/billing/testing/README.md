# billing/testing — slice E2E surface

- `seedInvoice({ organizationId, plan, amountCents, ... })` — insert an
  invoice. Defaults: status=paid, currency=EUR, period = last 30 days.
- `billingRoutes.index` — `/dashboard/billing`.
