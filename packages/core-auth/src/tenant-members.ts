import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getCoreDb } from './db'
import { schema } from './schema'
import type { Scope } from './scopes'
import { recordAudit } from './audit'
import { CORE_AUDIT_EVENTS, type AuditActor } from './audit-events'

/**
 * Per-tenant membership primitives. Authorisation reads
 * `tenant_member.scopes` directly — no role indirection in the data
 * layer. UI may render labels via `detectPreset()` (in `./permissions`)
 * but the persisted truth is the scope array.
 */

const { tenantMember } = schema

export type TenantMember = {
  id: string
  tenantId: string
  userId: string
  scopes: Scope[]
  createdAt: Date
}

/**
 * Add (or replace) a user's membership in a tenant. Idempotent on
 * `(tenantId, userId)` — re-calling with a new `scopes` array UPDATES
 * the existing row instead of inserting. UI grant flows use this.
 *
 * Set `scopes` to an empty array if the caller wants to keep the
 * membership row but with no powers; remove the membership outright
 * via `removeMember`.
 */
export async function upsertMember(input: {
  tenantId: string
  userId: string
  scopes: readonly Scope[]
  /** Actor performing the grant — required for audit attribution. */
  actor: AuditActor
}): Promise<TenantMember> {
  const db = getCoreDb()
  const now = new Date()
  const nextScopes = [...input.scopes]
  // Snapshot the previous scopes (if any) so the audit row records a
  // grant ("first time") distinctly from a re-grant ("scopes changed").
  const before = await db
    .select({ scopes: tenantMember.scopes })
    .from(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, input.tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .limit(1)
  const previousScopes = before[0]?.scopes ?? null
  const [row] = await db
    .insert(tenantMember)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      scopes: nextScopes,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [tenantMember.tenantId, tenantMember.userId],
      set: { scopes: nextScopes },
    })
    .returning()
  if (!row) throw new Error('[iedora/auth] tenant_member upsert returned no row')
  await recordAudit({
    event:
      previousScopes === null
        ? CORE_AUDIT_EVENTS.TENANT_MEMBER_ADDED
        : CORE_AUDIT_EVENTS.TENANT_MEMBER_SCOPES_UPDATED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: input.tenantId, userId: input.userId },
    meta:
      previousScopes === null
        ? { scopes: nextScopes }
        : { from: previousScopes, to: nextScopes },
  })
  return row
}

/** Remove a user from a tenant. No-op if the membership doesn't exist. */
export async function removeMember(input: {
  tenantId: string
  userId: string
  /** Actor performing the removal — required for audit attribution. */
  actor: AuditActor
}): Promise<void> {
  const db = getCoreDb()
  // Snapshot what we're removing so the audit row carries the
  // scope-set the member walked away with. After delete it's gone.
  const before = await db
    .select({ scopes: tenantMember.scopes })
    .from(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, input.tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .limit(1)
  const result = await db
    .delete(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, input.tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .returning({ id: tenantMember.id })
  // No-op when membership didn't exist — emit no audit so the timeline
  // isn't polluted with phantom removals from idempotent retries.
  if (result.length === 0) return
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_MEMBER_REMOVED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: input.tenantId, userId: input.userId },
    meta: { scopes: before[0]?.scopes ?? [] },
  })
}

/** Every member of a tenant. */
export async function listMembers(tenantId: string): Promise<TenantMember[]> {
  const db = getCoreDb()
  return db
    .select()
    .from(tenantMember)
    .where(eq(tenantMember.tenantId, tenantId))
}

/**
 * Read the scopes the user holds inside a specific tenant. Returns
 * `null` (not `[]`) when there's no membership row — caller decides
 * whether "no member" should fall back to anonymous behaviour or
 * outright deny.
 */
export async function getMemberScopes(input: {
  tenantId: string
  userId: string
}): Promise<Scope[] | null> {
  const db = getCoreDb()
  const rows = await db
    .select({ scopes: tenantMember.scopes })
    .from(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, input.tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .limit(1)
  return rows[0]?.scopes ?? null
}
