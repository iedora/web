import 'server-only'
import { randomUUID } from 'node:crypto'
import { desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { getCoreDb } from '../db'
import { schema } from '../schema'
import type { Scope } from '../rbac/scopes'
import { recordAudit } from '../audit/audit'
import { CORE_AUDIT_EVENTS, type AuditActor } from '../audit/audit-events'

/**
 * Cross-product tenant primitives. The single source of truth for
 * "what tenants exist + who belongs to them" — every product (menu,
 * future) consults this module instead of querying the
 * `core` schema directly.
 *
 * When core eventually splits into its own service, the implementation
 * here flips from `getCoreDb()` to an RPC client; this module's API
 * stays stable. Consumers don't change.
 *
 * Server-only: holds the Drizzle client + uses `crypto.randomUUID`.
 */

const { tenant, tenantMember } = schema

export type Tenant = {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new tenant + add the founder as its first member with the
 * given scope set. Single transaction so a half-created tenant (row
 * exists, no membership) is impossible.
 *
 * Caller controls the founder's scopes (usually `TENANT_ROLE_PRESETS.owner`).
 */
export async function createTenant(input: {
  name: string
  founder: { userId: string; scopes: readonly Scope[] }
  /**
   * Actor performing the creation. In the onboarding flow the actor
   * and the founder are the same user; in admin-driven provisioning
   * (future) they differ. Required so the audit row attributes the
   * change.
   */
  actor: AuditActor
}): Promise<Tenant> {
  const db = getCoreDb()
  const founderScopes = [...input.founder.scopes]
  const row = await db.transaction(async (tx) => {
    const id = randomUUID()
    const now = new Date()
    const [created] = await tx
      .insert(tenant)
      .values({ id, name: input.name, createdAt: now, updatedAt: now })
      .returning()
    if (!created) throw new Error('[iedora/auth] tenant insert returned no row')
    await tx.insert(tenantMember).values({
      id: randomUUID(),
      tenantId: id,
      userId: input.founder.userId,
      scopes: founderScopes,
      createdAt: now,
    })
    return created
  })
  // Two audit rows: the tenant came into being, AND the founder
  // membership was granted. Downstream tooling that filters on
  // `tenant.member.added` sees the founder grant uniformly with
  // every later invite, no special-case for "first member".
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_CREATED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: row.id },
    meta: { name: row.name },
  })
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_MEMBER_ADDED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: row.id, userId: input.founder.userId },
    meta: { scopes: founderScopes, founder: true },
  })
  return row
}

/**
 * Hard-delete a tenant. Cascades to `tenant_member` via FK. Intended for
 * rollback paths only — when a multi-step provisioning flow (create
 * tenant → create subscription → seed restaurant) fails mid-sequence and
 * leaves an orphaned tenant behind. Caller is responsible for cleaning
 * up downstream state (subscriptions, restaurants in other product DBs)
 * before calling; this only removes the core tenant row + memberships.
 */
export async function deleteTenant(input: {
  tenantId: string
  actor: AuditActor
  reason?: string
}): Promise<void> {
  const db = getCoreDb()
  await db.delete(tenant).where(eq(tenant.id, input.tenantId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_DELETED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: input.tenantId },
    meta: input.reason ? { reason: input.reason } : undefined,
  })
}

/**
 * Free-text search across `tenant.name` for admin pickers (e.g. the
 * restaurant-transfer flow). Ordered by recency, capped at 50.
 * Anyone can call — gating belongs at the caller (`requireScope`).
 */
export async function searchTenants(input: {
  search?: string
  limit?: number
}): Promise<Tenant[]> {
  const db = getCoreDb()
  const limit = Math.min(input.limit ?? 20, 50)
  if (!input.search) {
    return db.select().from(tenant).orderBy(desc(tenant.createdAt)).limit(limit)
  }
  return db
    .select()
    .from(tenant)
    .where(ilike(tenant.name, `%${input.search}%`))
    .orderBy(desc(tenant.createdAt))
    .limit(limit)
}

/** Returns the tenant if it exists, otherwise null. */
export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const db = getCoreDb()
  const rows = await db
    .select()
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Batched lookup — single round-trip for N ids. Returns a Map keyed
 * by id so callers can do O(1) lookup without re-indexing. Missing
 * ids are simply absent from the map. Empty input short-circuits.
 */
export async function getTenantsByIds(
  tenantIds: readonly string[],
): Promise<Map<string, Tenant>> {
  if (tenantIds.length === 0) return new Map()
  const db = getCoreDb()
  const rows = await db.select().from(tenant).where(inArray(tenant.id, tenantIds))
  return new Map(rows.map((t) => [t.id, t]))
}

/**
 * Every tenant the user is a member of. Used by the core product
 * picker + by anywhere that needs to enumerate the user's tenancy.
 */
export async function listUserTenants(userId: string): Promise<Tenant[]> {
  const db = getCoreDb()
  const memberRows = await db
    .select({ tenantId: tenantMember.tenantId })
    .from(tenantMember)
    .where(eq(tenantMember.userId, userId))
  if (memberRows.length === 0) return []
  const ids = memberRows.map((r) => r.tenantId)
  return db.select().from(tenant).where(inArray(tenant.id, ids))
}

/**
 * Fast yes/no: does the user belong to at least one tenant. Used by
 * the picker's "0 tenants → onboarding" fast-path before doing the
 * full list.
 */
export async function hasAnyTenant(userId: string): Promise<boolean> {
  const db = getCoreDb()
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(tenantMember)
    .where(eq(tenantMember.userId, userId))
    .limit(1)
  return rows.length > 0
}
