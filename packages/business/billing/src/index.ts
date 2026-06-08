/**
 * @iedora/billing — public API.
 *
 * Centralised billing primitives. `tenant_subscription` + `invoice`
 * tables live in the `core` schema (managed by this package); plan
 * codes are opaque strings each product interprets via its own plan
 * registry. Status taxonomy is Stripe-shape so the future webhook
 * handler maps 1:1.
 *
 * Cross-product callers (menu, …) import from here ONLY —
 * never reach into `core.tenant_subscription` directly.
 */

export { schema } from './schema'

export {
  SUBSCRIPTION_STATUSES,
  INVOICE_STATUSES,
  MANUAL_PAYMENT_METHODS,
  DEFAULT_CURRENCY,
  BILLING_AUDIT_EVENTS,
  isSubscriptionStatus,
  isInvoiceStatus,
  isManualPaymentMethod,
  type SubscriptionStatus,
  type InvoiceStatus,
  type ManualPaymentMethod,
  type Currency,
  type BillingAuditEvent,
} from './literals'

export {
  createSubscription,
  updateSubscription,
  cancelSubscription,
  getSubscription,
  listTenantSubscriptions,
  listTenantProducts,
  type Subscription,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
} from './subscriptions'

export {
  recordInvoice,
  markInvoicePaid,
  voidInvoice,
  listTenantInvoices,
  getInvoice,
  type Invoice,
  type RecordInvoiceInput,
  type ListInvoicesFilter,
} from './invoices'

export {
  recordManualPayment,
  listManualPayments,
  getLatestManualPayment,
  deleteManualPayment,
  paymentDiscount,
  paymentValidUntil,
  type ManualPayment,
  type RecordManualPaymentInput,
  type ListManualPaymentsFilter,
} from './manual-payments'

export {
  PLAN_CATALOG,
  getPlanCatalogEntry,
  getPlanPrice,
  listProductPlans,
  type PlanCatalogEntry,
} from './plans'
