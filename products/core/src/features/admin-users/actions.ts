'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { recordAudit, type AuditActor } from '@iedora/core-auth'
import { requireScope } from '../../guards'
import { SCOPES } from '@iedora/core-auth/scopes'
import { betterAuthAdminUsersGateway } from './adapters/better-auth'
import { banUser as banUserUseCase } from './use-cases/ban-user'
import { unbanUser as unbanUserUseCase } from './use-cases/unban-user'
import { setUserRole as setUserRoleUseCase } from './use-cases/set-role'
import { impersonateUser as impersonateUserUseCase } from './use-cases/impersonate'
import {
  revokeUserSession as revokeUserSessionUseCase,
  revokeUserSessions as revokeUserSessionsUseCase,
} from './use-cases/revoke-sessions'
import type { CrossTenantRole } from './use-cases/set-role'

/**
 * Server actions for admin-users. Every action:
 *  1. Re-asserts a per-verb capability scope (defence-in-depth — the
 *     route already gates, but actions can be POSTed standalone).
 *  2. Builds the gateway adapter, threading the calling actor so every
 *     mutation routed through it carries actor attribution into the
 *     `@iedora/core-auth` primitive's audit row.
 *  3. Delegates to the use-case, which holds the policy.
 *  4. Revalidates the affected paths.
 *
 * Audit emission: `user.banned`, `user.unbanned`, `user.impersonated`,
 * `user.scopes.updated` are emitted by the `@iedora/core-auth` primitives
 * themselves — no duplicate write here. Session-revoke events are
 * still emitted at the action layer because there's no dedicated
 * primitive yet (gateway goes straight to `db.delete(session)`).
 */

type ActionResult = { ok: true } | { ok: false; error: string }

function toAuditActor(session: {
  user: { id: string; email: string }
}): AuditActor {
  return { userId: session.user.id, email: session.user.email, role: null }
}

export async function banUserAction(input: {
  userId: string
  reason?: string
  expiresInDays?: number
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.ban)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  const result = await banUserUseCase(gateway, {
    userId: input.userId,
    reason: input.reason,
    expiresInDays: input.expiresInDays,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function unbanUserAction(input: {
  userId: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.ban)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  await unbanUserUseCase(gateway, { userId: input.userId })
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function setUserRoleAction(input: {
  userId: string
  role: CrossTenantRole | null
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.setRole)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  const result = await setUserRoleUseCase(gateway, {
    userId: input.userId,
    role: input.role,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function revokeUserSessionAction(input: {
  userId: string
  sessionToken: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.sessions.revoke)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  await revokeUserSessionUseCase(gateway, { sessionToken: input.sessionToken })
  await recordAudit({
    event: 'session.revoked',
    outcome: 'success',
    actor: toAuditActor(session),
    target: { userId: input.userId },
    headers: await headers(),
    important: true,
  })
  revalidatePath(`/core/admin/users/${input.userId}`)
  revalidatePath('/core/admin/sessions')
  return { ok: true }
}

export async function revokeAllUserSessionsAction(input: {
  userId: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.sessions.revoke)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  await revokeUserSessionsUseCase(gateway, { userId: input.userId })
  await recordAudit({
    event: 'session.all-revoked-for-user',
    outcome: 'success',
    actor: toAuditActor(session),
    target: { userId: input.userId },
    headers: await headers(),
    important: true,
  })
  revalidatePath(`/core/admin/users/${input.userId}`)
  revalidatePath('/core/admin/sessions')
  return { ok: true }
}

export async function impersonateUserAction(input: {
  userId: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.impersonate)
  const gateway = betterAuthAdminUsersGateway(toAuditActor(session))
  const result = await impersonateUserUseCase(gateway, {
    userId: input.userId,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  return { ok: true }
}
