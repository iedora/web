'use server'

import { revalidatePath } from 'next/cache'
import { requireIedoraAdmin } from '@/features/auth'
import { revokeAllForUser, revokeSession } from './index'

/**
 * Server actions for the admin sessions surface. Every action is gated
 * by `requireIedoraAdmin` — this is cross-tenant and absolutely must not
 * be exposed to regular users. The guard runs BEFORE the mutation; a
 * non-admin caller 404s before any row is touched.
 *
 * Revalidation: the page reads `listAllActiveSessions()` directly (no
 * cache tag), so a single `revalidatePath` on the admin route is enough
 * to refresh the table after a mutation.
 */

const ADMIN_PATH = '/dashboard/admin/sessions'

type ActionResult = { ok: true } | { ok: false; error: string }

export async function revokeSessionAction(sid: string): Promise<ActionResult> {
  await requireIedoraAdmin()
  try {
    await revokeSession(sid, 'admin_revoke')
    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (err) {
    console.error('[sessions/revokeSessionAction]', err)
    return { ok: false, error: 'Revoke failed.' }
  }
}

export async function revokeAllForUserAction(
  userId: string,
): Promise<ActionResult & { count?: number }> {
  await requireIedoraAdmin()
  try {
    const count = await revokeAllForUser(userId, 'admin_revoke')
    revalidatePath(ADMIN_PATH)
    return { ok: true, count }
  } catch (err) {
    console.error('[sessions/revokeAllForUserAction]', err)
    return { ok: false, error: 'Revoke failed.' }
  }
}
