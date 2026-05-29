'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@iedora/core-auth/audit'
import { requireScope } from '../../guards'
import { SCOPES } from '@iedora/core-auth/scopes'
import { betterAuthAdminSessionsGateway } from './adapters/better-auth'

type ActionResult = { ok: true } | { ok: false; error: string }

export async function revokeSessionAction(input: {
  sessionToken: string
}): Promise<ActionResult> {
  const session = await requireScope(SCOPES.core.staff.sessions.revoke)
  const gateway = betterAuthAdminSessionsGateway()
  await gateway.revokeSession({ sessionToken: input.sessionToken })
  await recordAudit({
    event: 'session.revoked',
    outcome: 'success',
    actor: {
      userId: session.user.id,
      role: null, // user.role replaced by user.scopes; audit row keeps null for searchability
      email: session.user.email,
    },
    headers: await headers(),
    important: true,
  })
  revalidatePath('/core/admin/sessions')
  return { ok: true }
}
