import { describe, it, expect } from 'vitest'
import {
  SUBSCRIPTION_STATUSES,
  INVOICE_STATUSES,
  DEFAULT_CURRENCY,
  BILLING_AUDIT_EVENTS,
  isSubscriptionStatus,
  isInvoiceStatus,
} from './literals'

describe('SUBSCRIPTION_STATUSES (Stripe-shape)', () => {
  it('contains the eight known statuses', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual([
      'trialing',
      'active',
      'past_due',
      'cancelled',
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'paused',
    ])
  })

  it('isSubscriptionStatus accepts canonical values', () => {
    for (const s of SUBSCRIPTION_STATUSES) {
      expect(isSubscriptionStatus(s)).toBe(true)
    }
  })

  it('rejects non-canonical values', () => {
    expect(isSubscriptionStatus('expired')).toBe(false)
    expect(isSubscriptionStatus('')).toBe(false)
    expect(isSubscriptionStatus(null)).toBe(false)
    expect(isSubscriptionStatus(42)).toBe(false)
  })
})

describe('INVOICE_STATUSES (Stripe-shape)', () => {
  it('contains the five known statuses', () => {
    expect([...INVOICE_STATUSES]).toEqual([
      'draft',
      'open',
      'paid',
      'void',
      'uncollectible',
    ])
  })

  it('isInvoiceStatus accepts canonical values + rejects others', () => {
    for (const s of INVOICE_STATUSES) expect(isInvoiceStatus(s)).toBe(true)
    expect(isInvoiceStatus('refunded')).toBe(false)
    expect(isInvoiceStatus(null)).toBe(false)
  })
})

describe('DEFAULT_CURRENCY', () => {
  it('is EUR (single-currency for now)', () => {
    expect(DEFAULT_CURRENCY).toBe('EUR')
  })
})

describe('BILLING_AUDIT_EVENTS', () => {
  it('exposes the six known event keys', () => {
    expect(Object.keys(BILLING_AUDIT_EVENTS).sort()).toEqual([
      'INVOICE_PAID',
      'INVOICE_RECORDED',
      'INVOICE_VOIDED',
      'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION_UPDATED',
    ])
  })

  it('uses namespaced dotted strings', () => {
    for (const v of Object.values(BILLING_AUDIT_EVENTS)) {
      expect(v).toMatch(/^(subscription|invoice)\.[a-z-]+$/)
    }
  })
})
