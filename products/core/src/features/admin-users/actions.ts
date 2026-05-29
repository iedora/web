'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@iedora/auth/audit'
import { requireScope } from '../../guards'
import { SCOPES } from '@iedora/auth/scopes'
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
 *     The scope picks the right staff tier: `iedora-support` can
 *     read/ban; `set-role` and `impersonate` are admin-only.
 *  2. Builds the better-auth gateway adapter.
 *  3. Delegates to the use-case, which holds the policy.
 *  4. Revalidates the users list path so the table reflects the change.
 *  5. Records the event in the audit log (success-only here; denials
 *     are emitted by `requireScope` before this function runs).
 */

type ActionResult = { ok: true } | { ok: false; error: string }

export async function banUserAction(input: {
  userId: string
  reason?: string
  expiresInDays?: number
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.ban)
  const gateway = betterAuthAdminUsersGateway()
  const result = await banUserUseCase(gateway, {
    userId: input.userId,
    reason: input.reason,
    expiresInDays: input.expiresInDays,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  await recordAudit({
    event: 'user.banned',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
    target: { userId: input.userId },
    headers: await headers(),
    meta: {
      reason: input.reason ?? null,
      expiresInDays: input.expiresInDays ?? null,
    },
    important: true,
  })
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function unbanUserAction(input: {
  userId: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.ban)
  const gateway = betterAuthAdminUsersGateway()
  await unbanUserUseCase(gateway, { userId: input.userId })
  await recordAudit({
    event: 'user.unbanned',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
    target: { userId: input.userId },
    headers: await headers(),
    important: true,
  })
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function setUserRoleAction(input: {
  userId: string
  role: CrossTenantRole | null
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.users.setRole)
  const gateway = betterAuthAdminUsersGateway()
  const result = await setUserRoleUseCase(gateway, {
    userId: input.userId,
    role: input.role,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  await recordAudit({
    event: 'user.role-changed',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
    target: { userId: input.userId },
    headers: await headers(),
    meta: { newRole: input.role },
    important: true,
  })
  revalidatePath('/core/admin/users')
  revalidatePath(`/core/admin/users/${input.userId}`)
  return { ok: true }
}

export async function revokeUserSessionAction(input: {
  userId: string
  sessionToken: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.sessions.revoke)
  const gateway = betterAuthAdminUsersGateway()
  await revokeUserSessionUseCase(gateway, { sessionToken: input.sessionToken })
  await recordAudit({
    event: 'session.revoked',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
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
  const gateway = betterAuthAdminUsersGateway()
  await revokeUserSessionsUseCase(gateway, { userId: input.userId })
  await recordAudit({
    event: 'session.all-revoked-for-user',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
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
  const gateway = betterAuthAdminUsersGateway()
  const result = await impersonateUserUseCase(gateway, {
    userId: input.userId,
    callerUserId: session.user.id,
  })
  if (!result.ok) return { ok: false, error: result.error.code }
  await recordAudit({
    event: 'user.impersonated',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
    target: { userId: input.userId },
    headers: await headers(),
    important: true,
  })
  return { ok: true }
}
