import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { signInUrl } from '@iedora/brand'
import { IEDORA_ADMIN_ROLE } from '../roles'
import type { AuthGateway, Session } from '../ports'

/**
 * Cross-tenant guard: caller must be signed in AND carry the `iedora-admin`
 * project role on their session. Used to gate Iedora-staff surfaces (QR
 * binding, future cross-org tooling) — these intentionally bypass tenant
 * scoping, so the role is the only gate.
 *
 * Failure modes:
 *   - no session     → bounce to /sign-in (same as `verifySession`)
 *   - missing role   → 404. We hide the existence of the surface from
 *                      tenant users; a 403 would advertise it.
 */
export async function requireIedoraAdmin(auth: AuthGateway): Promise<Session> {
  const session = await auth.getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }
  if (!session.user.roles.includes(IEDORA_ADMIN_ROLE)) {
    notFound()
  }
  return session
}
