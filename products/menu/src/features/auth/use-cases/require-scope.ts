import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { signInUrl } from '@iedora/product-core/url'
import { hasScope, ScopeDeniedError } from '@iedora/auth/server'
import { type Scope } from '@iedora/auth/scopes'
import type { AuthGateway, Session } from '../ports'

/**
 * Capability-based guard. Two-layer evaluation handled by
 * `@iedora/auth/server.hasScope`:
 *
 *   1. Staff (`user.scopes`) — wildcard short-circuits cross-tenant.
 *   2. Tenant (`tenant_member.scopes` for the active tenant).
 *
 * Failure modes:
 *   - no session     → bounce to /sign-in
 *   - missing scope  → 404. We hide the existence of the surface from
 *                      tenant users; 403 would advertise it.
 *
 * The thin wrapper here keeps menu's slice contract intact (consumers
 * still pass `auth: AuthGateway` for testability) while delegating
 * the actual decision to the cross-product helper.
 */
export async function requireScope(
  auth: AuthGateway,
  scope: Scope,
): Promise<Session> {
  const session = await auth.getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }

  try {
    const ok = await hasScope(scope)
    if (!ok) notFound()
  } catch (err) {
    if (err instanceof ScopeDeniedError) notFound()
    throw err
  }
  return session
}
