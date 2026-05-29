import 'server-only'
import { and, desc, eq, gt, ilike, isNotNull, isNull, or } from 'drizzle-orm'
import { getCoreDb } from './db'
import { schema } from './schema'
import type { Scope } from './scopes'
import { recordAudit } from './audit'
import { CORE_AUDIT_EVENTS, type AuditActor } from './audit-events'

/**
 * Cross-tenant (staff) authority primitives. Lives parallel to
 * `tenant-members.ts` (per-tenant authority) and exposes the same
 * shape — `getUserScopes` / `setUserScopes` / `userHasScope` — over
 * the `user.scopes text[]` column.
 *
 * `user.scopes IS NULL` ⇔ regular tenant user (no cross-tenant
 * authority). `user.scopes IS NOT NULL` ⇔ staff (carries an
 * explicit scope set). Adding a new staff role like `'iedora-
 * auditor'` is one entry in `STAFF_ROLE_PRESETS` (in `./permissions`)
 * — this module's signatures don't change.
 *
 * Also home to the ban + impersonation primitives that previously
 * came from better-auth's `admin` plugin. The plugin was dropped to
 * keep staff authority in the same scope-array shape as tenant
 * authority; ban/impersonate are short helpers around the schema
 * columns better-auth had configured.
 */

const { user, session } = schema

export type UserRow = {
  id: string
  name: string
  email: string
  scopes: Scope[] | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
  createdAt: Date
  updatedAt: Date
}

// ─── Staff scope reads / writes ────────────────────────────────────

/** Returns the user's staff scopes, or `null` when they're a tenant. */
export async function getUserScopes(userId: string): Promise<Scope[] | null> {
  const db = getCoreDb()
  const rows = await db
    .select({ scopes: user.scopes })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return rows[0]?.scopes ?? null
}

/**
 * Set / clear the user's staff scopes. Pass `null` to demote a staff
 * user to regular tenant. Pass `[]` to keep staff status but strip
 * every power (rare; use `null` instead unless there's a reason).
 */
export async function setUserScopes(
  userId: string,
  scopes: readonly Scope[] | null,
  /** Actor performing the grant. Required — highest blast surface. */
  actor: AuditActor,
): Promise<void> {
  const db = getCoreDb()
  // Snapshot before so the audit row carries the delta.
  const before = await db
    .select({ scopes: user.scopes })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const previous = before[0]?.scopes ?? null
  const next = scopes === null ? null : [...scopes]
  await db
    .update(user)
    .set({ scopes: next, updatedAt: new Date() })
    .where(eq(user.id, userId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.USER_SCOPES_UPDATED,
    outcome: 'success',
    actor,
    target: { userId },
    meta: { from: previous, to: next },
  })
}

/**
 * Non-throwing scope probe over `user.scopes`. Returns false for
 * anonymous / tenant-only users and for ban'd staff.
 */
export async function userHasScope(
  userId: string,
  scope: Scope,
): Promise<boolean> {
  const scopes = await getUserScopes(userId)
  return scopes?.includes(scope) ?? false
}

/** True iff the user has any staff scope at all. */
export async function isStaffUser(userId: string): Promise<boolean> {
  const scopes = await getUserScopes(userId)
  return scopes !== null && scopes.length > 0
}

// ─── Ban / unban (was: better-auth admin plugin `banUser`) ─────────

export async function banUser(input: {
  userId: string
  reason?: string
  expiresAt?: Date
  /** Actor performing the ban — required for audit attribution. */
  actor: AuditActor
}): Promise<void> {
  const db = getCoreDb()
  await db
    .update(user)
    .set({
      banned: true,
      banReason: input.reason ?? null,
      banExpires: input.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, input.userId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.USER_BANNED,
    outcome: 'success',
    actor: input.actor,
    target: { userId: input.userId },
    meta: {
      reason: input.reason ?? null,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  })
}

export async function unbanUser(
  userId: string,
  /** Actor performing the unban — required for audit attribution. */
  actor: AuditActor,
): Promise<void> {
  const db = getCoreDb()
  await db
    .update(user)
    .set({
      banned: false,
      banReason: null,
      banExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.USER_UNBANNED,
    outcome: 'success',
    actor,
    target: { userId },
  })
}

/**
 * Is the user currently banned (and the ban hasn't expired)? Used by
 * the request gate before allowing the session through.
 */
export async function isBanned(userId: string): Promise<boolean> {
  const db = getCoreDb()
  const now = new Date()
  const rows = await db
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const row = rows[0]
  if (!row?.banned) return false
  if (row.banExpires && row.banExpires.getTime() <= now.getTime()) return false
  return true
}

// ─── Impersonation (was: better-auth admin plugin `impersonateUser`) ─

/**
 * Start impersonating `targetUserId` from the actor's existing
 * session. Mutates the session in-place: `userId` flips to the
 * target, `impersonatedBy` stores the actor for audit + revert. The
 * caller is responsible for verifying the actor holds the
 * `staff.core.users:impersonate` scope first.
 *
 * Returns the updated session row.
 */
export async function impersonateUser(input: {
  actorSessionId: string
  actorUserId: string
  targetUserId: string
  /** Actor metadata for audit (email + role label). */
  actor: AuditActor
}): Promise<void> {
  const db = getCoreDb()
  await db
    .update(session)
    .set({
      userId: input.targetUserId,
      impersonatedBy: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(eq(session.id, input.actorSessionId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.USER_IMPERSONATED,
    outcome: 'success',
    actor: input.actor,
    target: { userId: input.targetUserId, sessionId: input.actorSessionId },
  })
}

/**
 * Stop impersonation — restore the session to the actor recorded in
 * `impersonatedBy`. No-op if the session wasn't impersonating.
 */
export async function stopImpersonating(
  sessionId: string,
  /** Actor stopping the impersonation — required for audit attribution. */
  actor: AuditActor,
): Promise<void> {
  const db = getCoreDb()
  const rows = await db
    .select({
      impersonatedBy: session.impersonatedBy,
      currentUserId: session.userId,
    })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1)
  const originalActor = rows[0]?.impersonatedBy
  if (!originalActor) return
  const impersonatedUserId = rows[0]?.currentUserId ?? null
  await db
    .update(session)
    .set({
      userId: originalActor,
      impersonatedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(session.id, sessionId))
  await recordAudit({
    event: CORE_AUDIT_EVENTS.USER_IMPERSONATION_STOPPED,
    outcome: 'success',
    actor,
    target: { userId: impersonatedUserId, sessionId },
  })
}

// ─── User listing (was: better-auth admin plugin `listUsers`) ──────

export type ListUsersFilter = {
  /** Free-text — matches email or name (ILIKE). */
  search?: string
  /** Only staff (scopes IS NOT NULL) or only tenants (IS NULL). */
  kind?: 'staff' | 'tenant'
  /** Only banned users (banned=true AND not expired). */
  bannedOnly?: boolean
  limit?: number
  offset?: number
}

export type ListUsersResult = {
  users: UserRow[]
  hasMore: boolean
}

export async function listUsers(
  filter: ListUsersFilter = {},
): Promise<ListUsersResult> {
  const db = getCoreDb()
  const limit = Math.min(filter.limit ?? 50, 200)
  const offset = Math.max(filter.offset ?? 0, 0)

  const conditions = []
  if (filter.search) {
    const q = `%${filter.search}%`
    conditions.push(or(ilike(user.email, q), ilike(user.name, q))!)
  }
  if (filter.kind === 'staff') conditions.push(isNotNull(user.scopes))
  if (filter.kind === 'tenant') conditions.push(isNull(user.scopes))
  if (filter.bannedOnly) {
    const now = new Date()
    conditions.push(eq(user.banned, true))
    conditions.push(
      or(isNull(user.banExpires), gt(user.banExpires, now))!,
    )
  }

  const rows = await db
    .select()
    .from(user)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(user.createdAt))
    .limit(limit + 1)
    .offset(offset)

  const hasMore = rows.length > limit
  const out = rows.slice(0, limit) as UserRow[]
  return { users: out, hasMore }
}

/** Single-user read. Returns null when not found. */
export async function getUser(userId: string): Promise<UserRow | null> {
  const db = getCoreDb()
  const rows = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return (rows[0] as UserRow | undefined) ?? null
}
