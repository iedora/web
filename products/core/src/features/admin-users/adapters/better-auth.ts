import 'server-only'
import { desc, eq } from 'drizzle-orm'
import {
  getCoreDb,
  schema,
  detectStaffPreset,
  STAFF_ROLE_PRESETS,
  isStaffRole,
  type AuditActor,
} from '@iedora/core-auth'
import {
  banUser as banUserCore,
  unbanUser as unbanUserCore,
  setUserScopes,
  impersonateUser as impersonateUserCore,
  listUsers as listUsersCore,
  getSession,
} from '@iedora/core-auth/server'
import type { Scope } from '@iedora/core-auth/scopes'
import type {
  AdminUser,
  AdminUserSession,
  AdminUsersGateway,
  ListUsersInput,
  ListUsersResult,
} from '../ports'

/**
 * Admin-users gateway. Used to wrap `auth.api.*` (better-auth admin
 * plugin); after the tenancy refactor, plumbed against our own
 * `@iedora/core-auth/server` helpers (which work over the same schema
 * columns better-auth used to manage).
 *
 * `actor` is captured at construction so every mutation routed
 * through this gateway carries it into the corresponding primitive's
 * audit row. Pages that only need reads can omit it; mutation
 * methods throw if a caller forgets it.
 */
export function betterAuthAdminUsersGateway(
  actor?: AuditActor,
): AdminUsersGateway {
  const requireActor = (op: string): AuditActor => {
    if (!actor) {
      throw new Error(
        `[admin-users] ${op}: gateway built without actor; only reads are allowed`,
      )
    }
    return actor
  }
  return {
    async listUsers(input: ListUsersInput): Promise<ListUsersResult> {
      const offset = (input.page - 1) * input.pageSize
      // Map admin UI's `kind` filter ('staff' / 'tenant') onto our
      // listUsers helper. Role-string filter is converted to "staff
      // preset matches": match if user.scopes equals the preset.
      const kindFilter =
        input.role === 'iedora-admin' || input.role === 'iedora-support'
          ? 'staff'
          : input.role === 'member'
            ? 'tenant'
            : undefined
      const result = await listUsersCore({
        limit: input.pageSize,
        offset,
        search: input.q,
        kind: kindFilter,
        bannedOnly: input.banned === true ? true : undefined,
      })
      let users = result.users.map(mapUser)
      // When a SPECIFIC staff preset is requested, narrow to that one.
      if (isStaffRole(input.role)) {
        users = users.filter((u) => u.role === input.role)
      }
      // Best-effort total — listUsersCore doesn't return one yet; the
      // admin UI shows "page X" without a hard count today.
      return {
        users,
        total: users.length + (result.hasMore ? input.pageSize : 0),
        page: input.page,
        pageSize: input.pageSize,
      }
    },

    async getUserById({ userId }) {
      const db = getCoreDb()
      const [row] = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .limit(1)
      if (!row) return null
      return mapUser(row)
    },

    async listUserSessions({ userId }) {
      const db = getCoreDb()
      const rows = await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, userId))
        .orderBy(desc(schema.session.createdAt))
      return rows.map<AdminUserSession>((s) => ({
        id: s.id,
        token: s.token,
        userId,
        ipAddress: s.ipAddress ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: new Date(s.createdAt),
        expiresAt: new Date(s.expiresAt),
        impersonatedBy: s.impersonatedBy ?? null,
      }))
    },

    async banUser({ userId, reason, expiresInSec }) {
      const expiresAt =
        typeof expiresInSec === 'number'
          ? new Date(Date.now() + expiresInSec * 1000)
          : undefined
      await banUserCore({ userId, reason, expiresAt, actor: requireActor('banUser') })
    },

    async unbanUser({ userId }) {
      await unbanUserCore(userId, requireActor('unbanUser'))
    },

    async setRole({ userId, role }) {
      // Expand the named preset (or clear scopes to null) and persist
      // directly onto `user.scopes`. Audit row is emitted by
      // `setUserScopes` itself — actor flows through the closure.
      const scopes =
        role && isStaffRole(role) ? STAFF_ROLE_PRESETS[role] : null
      await setUserScopes(
        userId,
        scopes as readonly Scope[] | null,
        requireActor('setRole'),
      )
    },

    async revokeUserSessions({ userId }) {
      const db = getCoreDb()
      await db.delete(schema.session).where(eq(schema.session.userId, userId))
    },

    async revokeUserSession({ sessionToken }) {
      const db = getCoreDb()
      await db.delete(schema.session).where(eq(schema.session.token, sessionToken))
    },

    async impersonateUser({ userId }) {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('[admin-users] impersonate: caller has no session')
      }
      await impersonateUserCore({
        actorSessionId: session.session.id,
        actorUserId: session.user.id,
        targetUserId: userId,
        actor: requireActor('impersonateUser'),
      })
    },
  }
}

function mapUser(u: {
  id: string
  email: string
  name: string
  emailVerified?: boolean | null
  scopes?: Scope[] | string[] | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: Date | string | number | null
  createdAt: Date | string
  updatedAt: Date | string
}): AdminUser {
  const banExpires = u.banExpires
    ? new Date(u.banExpires).getTime()
    : null
  // Detect named preset for UI display. Custom scope sets show as null
  // ("Custom") — the admin UI can choose to label them as such.
  const role =
    u.scopes && u.scopes.length > 0
      ? detectStaffPreset(u.scopes as readonly Scope[])
      : null
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: Boolean(u.emailVerified),
    role,
    scopes: (u.scopes as string[] | null | undefined) ?? null,
    banned: Boolean(u.banned),
    banReason: u.banReason ?? null,
    banExpires,
    createdAt: new Date(u.createdAt),
    updatedAt: new Date(u.updatedAt),
  }
}
