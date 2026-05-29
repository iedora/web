import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getCoreDb } from './db'
import { schema } from './schema'
import { recordAudit } from './audit'
import { CORE_AUDIT_EVENTS, type AuditActor } from './audit-events'

/**
 * Session-level tenant state — which tenant the caller is currently
 * "inside". Stored as a column on `core.session` so a logged-out user
 * loses it implicitly with their cookie.
 *
 * Lazy revalidation policy: `getActiveTenantId` checks the membership
 * still exists on every read. A user kicked from a tenant while their
 * session is still pointing there gets `null` back (caller routes to
 * picker / onboarding). No background sweep, no race on `tenant_member`
 * delete — the active id stays orphan in the DB column until the next
 * `setActiveTenant`, which is fine because nobody reads it directly.
 */

const { session, tenantMember } = schema

/**
 * Returns the active tenant id IFF the user still belongs to it.
 * Returns `null` if there's no active id, no such session, or the
 * membership disappeared since last set.
 */
export async function getActiveTenantId(input: {
  sessionId: string
  userId: string
}): Promise<string | null> {
  const db = getCoreDb()
  const rows = await db
    .select({ activeTenantId: session.activeTenantId })
    .from(session)
    .where(eq(session.id, input.sessionId))
    .limit(1)
  const tenantId = rows[0]?.activeTenantId
  if (!tenantId) return null

  // Revalidate membership — the user may have been removed since.
  const member = await db
    .select({ one: tenantMember.id })
    .from(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .limit(1)
  return member.length > 0 ? tenantId : null
}

/**
 * Set the active tenant for a session. Verifies membership first —
 * a caller cannot pin their session to a tenant they don't belong to.
 * Throws on missing membership; UI should funnel through the picker
 * (which only shows tenants the user actually has).
 */
export async function setActiveTenant(input: {
  sessionId: string
  userId: string
  tenantId: string
  /**
   * Actor flipping the active tenant — practically always the
   * session owner, but accepted explicitly so the audit row is
   * consistent with every other primitive.
   */
  actor: AuditActor
}): Promise<void> {
  const db = getCoreDb()
  const member = await db
    .select({ one: tenantMember.id })
    .from(tenantMember)
    .where(
      and(
        eq(tenantMember.tenantId, input.tenantId),
        eq(tenantMember.userId, input.userId),
      ),
    )
    .limit(1)
  if (member.length === 0) {
    throw new Error(
      `[iedora/auth] cannot set active tenant: user ${input.userId} is not a member of ${input.tenantId}`,
    )
  }
  // Capture the previous active id so the audit row distinguishes
  // first-pin ("just signed in, landed on tenant T") from explicit
  // switch ("was on A, moved to B").
  const before = await db
    .select({ active: session.activeTenantId })
    .from(session)
    .where(eq(session.id, input.sessionId))
    .limit(1)
  const previous = before[0]?.active ?? null
  await db
    .update(session)
    .set({ activeTenantId: input.tenantId })
    .where(eq(session.id, input.sessionId))
  // No-op audit when the active id didn't actually change — saves the
  // timeline from a wall of identical switches when a layout re-pins
  // on every render.
  if (previous === input.tenantId) return
  await recordAudit({
    event: CORE_AUDIT_EVENTS.TENANT_ACTIVE_SWITCHED,
    outcome: 'success',
    actor: input.actor,
    target: { tenantId: input.tenantId, sessionId: input.sessionId },
    meta: { from: previous, to: input.tenantId },
    // High-volume, low-blast — kept off the default timeline.
    important: false,
  })
}
