import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { signInUrl } from '@iedora/brand'
import { auth as iedoraAuth } from '@iedora/auth'
import { scopeToPermission, type Scope } from '../scopes'
import type { AuthGateway, Session } from '../ports'

/**
 * Capability-based guard. Resolves the caller's permissions through the
 * @iedora/auth organization plugin's `hasPermission` API, which evaluates
 * the user's per-org `member.role` against the access-control taxonomy
 * declared in `@iedora/auth/permissions`.
 *
 * Cross-tenant staff (`session.user.role === 'iedora-admin'`) shortcuts
 * to allowed — the wildcard role bound to every (resource, action) pair.
 *
 * Failure modes:
 *   - no session     → bounce to /sign-in (same as `verifySession`)
 *   - missing scope  → 404. We hide the existence of the surface from
 *                      tenant users; 403 would advertise it.
 */
export async function requireScope(
  auth: AuthGateway,
  scope: Scope,
): Promise<Session> {
  const session = await auth.getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }

  // Wildcard short-circuit for cross-tenant staff. Avoids a roundtrip
  // through the org-scoped permission API for callers we already know
  // can do everything.
  if (session.user.role === 'iedora-admin') {
    return session
  }

  const { success } = await iedoraAuth.api.hasPermission({
    body: { permissions: scopeToPermission(scope) as never },
    headers: await headers(),
  })
  if (!success) {
    notFound()
  }
  return session
}
