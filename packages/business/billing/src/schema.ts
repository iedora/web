import {
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  index,
  uniqueIndex,
  pgSchema,
} from 'drizzle-orm/pg-core'
import type { ProductId } from '@iedora/brand'

import type {
  SubscriptionStatus,
  InvoiceStatus,
  Currency,
  ManualPaymentMethod,
} from './literals'

/**
 * Billing tables — live in the `core` schema alongside auth, since
 * core owns the cross-product billing surface. Tenant references are
 * real FK CONSTRAINTS within core; cross-product references (product
 * code, plan code) stay opaque strings because each product owns its
 * own plan registry.
 *
 * Tables:
 *   - `tenant_subscription` — one row per (tenant, product).
 *     UNIQUE constraint enforces "a tenant can be enrolled in a
 *     given product only once". Plan codes are namespace-free strings
 *     ("free" / "casa" / "agency"); the product interprets them.
 *   - `invoice` — append-only ledger of issued invoices, denormalised
 *     with `product` + `plan_code` snapshot so historical rows survive
 *     a plan rename in code.
 */

const coreSchema = pgSchema('core')

export const tenantSubscription = coreSchema.table(
  'tenant_subscription',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Cross-product discriminator — typed via `ProductId`. */
    product: text('product').$type<ProductId>().notNull(),
    /** Product-defined plan string (`'free'`, `'casa'`, ...). */
    plan: text('plan').notNull(),
    /** Stripe-shape status (see `./literals.ts`). */
    status: text('status').$type<SubscriptionStatus>().notNull(),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end')
      .notNull()
      .default(false),
    /** External billing references — populated when Stripe is wired. */
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_subscription_tenant_product_uniq').on(
      t.tenantId,
      t.product,
    ),
    index('tenant_subscription_tenant_idx').on(t.tenantId),
    index('tenant_subscription_product_idx').on(t.product),
  ],
)

export const invoice = coreSchema.table(
  'invoice',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    product: text('product').$type<ProductId>().notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    status: text('status').$type<InvoiceStatus>().notNull(),
    /**
     * Snapshot of the plan code at the moment of issuance. A rename
     * or removal of a plan in code never rewrites historical rows.
     */
    planCode: text('plan_code').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    stripeInvoiceId: text('stripe_invoice_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('invoice_tenant_issued_idx').on(t.tenantId, t.issuedAt),
    index('invoice_tenant_product_issued_idx').on(
      t.tenantId,
      t.product,
      t.issuedAt,
    ),
    index('invoice_status_idx').on(t.status),
  ],
)

/**
 * `manual_payment` — admin-recorded offline payments (MBWay, cash).
 * Lives parallel to `invoice` because the source-of-truth is different:
 * invoices are issued *by* iedora (Stripe-driven, eventually); manual
 * payments are *received* off-channel and stamped into the ledger by
 * an iedora-admin via the `/core/admin/payments` surface.
 *
 *   - `amountCents` is what the customer actually paid — discount is
 *     derived (`plan.monthlyCents × validMonths − amountCents`), never
 *     stored, so changing the plan's list price re-prices history
 *     visibly.
 *   - `validMonths` says how many months this single payment covers.
 *     Combined with `paidAt` you derive the validity window
 *     (`paidAt → paidAt + validMonths`) in the UI.
 *   - `campaignTag` is free-text ("beta-user", "launch-50") — used by
 *     the UI as a chip + by reports for grouping.
 *   - `createdByUserId` is the admin who recorded; required so the
 *     ledger has attribution without round-tripping the audit log.
 */
export const manualPayment = coreSchema.table(
  'manual_payment',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Cross-product discriminator (`'menu'`, ...). */
    product: text('product').$type<ProductId>().notNull(),
    /** Snapshot of the plan code at the moment of payment. */
    planCode: text('plan_code').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validMonths: smallint('valid_months').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    method: text('method').$type<ManualPaymentMethod>().notNull(),
    /** Free-text campaign label — surfaces as a chip in the UI. */
    campaignTag: text('campaign_tag'),
    notes: text('notes'),
    /** Admin who recorded the payment. */
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // "Latest payment for tenant" — the tenant billing card's hot path.
    index('manual_payment_tenant_paid_idx').on(t.tenantId, t.paidAt),
    index('manual_payment_method_idx').on(t.method),
    index('manual_payment_campaign_idx').on(t.campaignTag),
  ],
)

export const schema = {
  tenantSubscription,
  invoice,
  manualPayment,
} as const
