import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getCoreDb, recordAudit } from '@iedora/core-auth'
import type { ProductId } from '@iedora/brand'

import { schema } from './schema'
import {
  type SubscriptionStatus,
  BILLING_AUDIT_EVENTS,
} from './literals'

/**
 * Subscription primitives. Cross-product helpers — every product
 * (menu, imopush, …) talks to this module instead of querying the
 * `core` schema directly. When core eventually splits into its own
 * service, the implementation here flips to an RPC client; the
 * exported signatures stay stable.
 *
 * Audit hooks fire on every create / update / cancel. Read ops
 * (`getSubscription`, `listTenantSubscriptions`) are silent.
 */

const { tenantSubscription } = schema

export type Subscription = typeof tenantSubscription.$inferSelect

export type CreateSubscriptionInput = {
  tenantId: string
  product: ProductId
  plan: string
  status: SubscriptionStatus
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  stripeSubscriptionId?: string | null
  stripeCustomerId?: string | null
  /** Actor info for the audit row. The user who initiated the action. */
  actor: { userId: string; email?: string | null }
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<Subscription> {
  const db = getCoreDb()
  const id = randomUUID()
  const now = new Date()
  const [row] = await db
    .insert(tenantSubscription)
    .values({
      id,
      tenantId: input.tenantId,
      product: input.product,
      plan: input.plan,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!row)
    throw new Error('[iedora/billing] createSubscription returned no row')

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.SUBSCRIPTION_CREATED,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: input.tenantId },
    meta: {
      subscriptionId: id,
      product: input.product,
      plan: input.plan,
      status: input.status,
    },
    important: true,
  })

  return row
}

export type UpdateSubscriptionInput = {
  subscriptionId: string
  plan?: string
  status?: SubscriptionStatus
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  stripeSubscriptionId?: string | null
  stripeCustomerId?: string | null
  actor: { userId: string; email?: string | null }
}

export async function updateSubscription(
  input: UpdateSubscriptionInput,
): Promise<Subscription | null> {
  const db = getCoreDb()
  const now = new Date()
  const fields: Record<string, unknown> = { updatedAt: now }
  if (input.plan !== undefined) fields.plan = input.plan
  if (input.status !== undefined) fields.status = input.status
  if (input.currentPeriodStart !== undefined)
    fields.currentPeriodStart = input.currentPeriodStart
  if (input.currentPeriodEnd !== undefined)
    fields.currentPeriodEnd = input.currentPeriodEnd
  if (input.cancelAtPeriodEnd !== undefined)
    fields.cancelAtPeriodEnd = input.cancelAtPeriodEnd
  if (input.stripeSubscriptionId !== undefined)
    fields.stripeSubscriptionId = input.stripeSubscriptionId
  if (input.stripeCustomerId !== undefined)
    fields.stripeCustomerId = input.stripeCustomerId

  const [row] = await db
    .update(tenantSubscription)
    .set(fields)
    .where(eq(tenantSubscription.id, input.subscriptionId))
    .returning()
  if (!row) return null

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.SUBSCRIPTION_UPDATED,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: row.tenantId },
    meta: {
      subscriptionId: row.id,
      product: row.product,
      changes: fields,
    },
    important: true,
  })

  return row
}

/**
 * Mark a subscription cancelled. Convenience over `updateSubscription`
 * that emits the dedicated `subscription.cancelled` audit event.
 */
export async function cancelSubscription(input: {
  subscriptionId: string
  immediate?: boolean
  actor: { userId: string; email?: string | null }
}): Promise<Subscription | null> {
  const db = getCoreDb()
  const now = new Date()
  const [row] = await db
    .update(tenantSubscription)
    .set(
      input.immediate
        ? { status: 'cancelled', cancelAtPeriodEnd: false, updatedAt: now }
        : { cancelAtPeriodEnd: true, updatedAt: now },
    )
    .where(eq(tenantSubscription.id, input.subscriptionId))
    .returning()
  if (!row) return null

  await recordAudit({
    event: BILLING_AUDIT_EVENTS.SUBSCRIPTION_CANCELLED,
    outcome: 'success',
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    target: { tenantId: row.tenantId },
    meta: {
      subscriptionId: row.id,
      product: row.product,
      immediate: input.immediate ?? false,
    },
    important: true,
  })

  return row
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function getSubscription(
  tenantId: string,
  product: ProductId,
): Promise<Subscription | null> {
  const db = getCoreDb()
  const rows = await db
    .select()
    .from(tenantSubscription)
    .where(
      and(
        eq(tenantSubscription.tenantId, tenantId),
        eq(tenantSubscription.product, product),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listTenantSubscriptions(
  tenantId: string,
): Promise<Subscription[]> {
  const db = getCoreDb()
  return db
    .select()
    .from(tenantSubscription)
    .where(eq(tenantSubscription.tenantId, tenantId))
}

/**
 * The product enrolment list — derived from `listTenantSubscriptions`
 * by extracting the `product` discriminator. Used by the core picker
 * to decide redirect vs chooser.
 */
export async function listTenantProducts(
  tenantId: string,
): Promise<ProductId[]> {
  const subs = await listTenantSubscriptions(tenantId)
  return subs.map((s) => s.product)
}
