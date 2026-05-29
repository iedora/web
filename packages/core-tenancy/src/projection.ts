import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import {
  getCoreDb,
  recordAudit,
  CORE_AUDIT_EVENTS,
  type AuditActor,
} from '@iedora/auth'
import type {
  ProductId,
  ProductOnboardingStatus,
  OnboardingStepValueFor,
} from '@iedora/brand'
import { tenantProductState, type TenantProductStateRow } from './schema'

/**
 * Write-through projection: called by each product after it mutates
 * its OWN onboarding state. Idempotent on `(tenant_id, product)` —
 * second call upserts. The `completed_at` timestamp is set only on
 * the transition into `completed` / `skipped`; status downgrades
 * (e.g. a tenant kicks off a new flow after completing) clear it
 * back to NULL.
 *
 * Audit emission: every projection mutation writes one
 * `CORE_AUDIT_EVENTS.TENANT_PRODUCT_STATE_PROJECTED` row so the admin
 * timeline shows the lifecycle without needing to query the table.
 */
export async function projectProductState<P extends ProductId>(input: {
  tenantId: string
  product: P
  status: ProductOnboardingStatus
  /** Step KEY (kebab string) from `PRODUCT_ONBOARDING_STEPS[product]`. */
  currentStep?: OnboardingStepValueFor<P> | null
  /** Product-owned free-form payload. Core never reads it. */
  payload?: Record<string, unknown> | null
  actor: AuditActor
}): Promise<TenantProductStateRow> {
  const db = getCoreDb()
  const now = new Date()
  const terminal = input.status === 'completed' || input.status === 'skipped'
  const completedAt = terminal ? now : null
  const id = randomUUID()
  const [row] = await db
    .insert(tenantProductState)
    .values({
      id,
      tenantId: input.tenantId,
      product: input.product,
      status: input.status,
      currentStep: (input.currentStep ?? null) as string | null,
      payload: input.payload ?? null,
      startedAt: now,
      completedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [tenantProductState.tenantId, tenantProductState.product],
      set: {
        status: input.status,
        currentStep: (input.currentStep ?? null) as string | null,
        payload: input.payload ?? null,
        completedAt,
        updatedAt: now,
      },
    })
    .returning()
  if (!row) {
    throw new Error('[iedora/tenancy] tenant_product_state upsert returned no row')
  }
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_PRODUCT_STATE_PROJECTED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: input.tenantId },
    meta: {
      product: input.product,
      status: input.status,
      currentStep: (input.currentStep ?? null) as string | null,
    },
    important: terminal,
  })
  return row
}

/** Read the current projection for one (tenant, product) pair. */
export async function getProductState(input: {
  tenantId: string
  product: ProductId
}): Promise<TenantProductStateRow | null> {
  const db = getCoreDb()
  const rows = await db
    .select()
    .from(tenantProductState)
    .where(
      and(
        eq(tenantProductState.tenantId, input.tenantId),
        eq(tenantProductState.product, input.product),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * List every product state row for a tenant. Used by the admin tenant
 * detail page to render the "Products" section without knowing which
 * products exist — the table tells it.
 */
export async function listTenantProductStates(
  tenantId: string,
): Promise<TenantProductStateRow[]> {
  const db = getCoreDb()
  return db
    .select()
    .from(tenantProductState)
    .where(eq(tenantProductState.tenantId, tenantId))
    .orderBy(asc(tenantProductState.product))
}
