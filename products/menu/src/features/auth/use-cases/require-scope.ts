import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { signInUrl } from '@/shared/brand'
import type { Scope } from '../scopes'
import type { AuthGateway, Session } from '../ports'

/**
 * Cross-tenant scope-based guard. The user's `session.permissions` is
 * the authoritative flat list (produced by the Zitadel Actions v2
 * webhook that expands bundle role-grants into atomic scopes).
 *
 * Failure modes:
 *   - no session     → bounce to /api/auth/login (same as `verifySession`)
 *   - missing scope  → 404. We hide the existence of the surface from
 *                      tenant users; 403 would advertise it.
 */
export async function requireScope(auth: AuthGateway, scope: Scope): Promise<Session> {
  const session = await auth.getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }
  if (!session.user.permissions.includes(scope)) {
    notFound()
  }
  return session
}
