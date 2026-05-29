/**
 * Billing literal taxonomy — Stripe-shape so a future webhook can map
 * 1:1 without translation. Single source for every status string that
 * lands in the DB or on the wire.
 *
 * Framework-free. Imported from server modules AND from tests.
 */

// ─── Subscription status (Stripe-shape) ────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export function isSubscriptionStatus(v: unknown): v is SubscriptionStatus {
  return (
    typeof v === 'string' &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(v)
  )
}

// ─── Invoice status (Stripe-shape) ─────────────────────────────────

export const INVOICE_STATUSES = [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return (
    typeof v === 'string' && (INVOICE_STATUSES as readonly string[]).includes(v)
  )
}

// ─── Currency (ISO 4217 — single tenant-currency for now) ──────────

/**
 * Today every iedora subscription is denominated in EUR. The column
 * stays text so multi-currency is a single migration away.
 */
export const DEFAULT_CURRENCY = 'EUR' as const
export type Currency = typeof DEFAULT_CURRENCY | (string & {})

// ─── Audit events emitted by billing helpers ───────────────────────

export const BILLING_AUDIT_EVENTS = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  INVOICE_RECORDED: 'invoice.recorded',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_VOIDED: 'invoice.voided',
} as const
export type BillingAuditEvent =
  (typeof BILLING_AUDIT_EVENTS)[keyof typeof BILLING_AUDIT_EVENTS]
