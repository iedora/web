import 'server-only'
import { redirect } from 'next/navigation'
import type { AuthGateway } from '../ports'
import { verifySession } from './verify-session'

/**
 * Guarantees an authenticated session AND a resolved tenantId.
 * Redirects to /onboarding when the user has no active organization yet
 * (first sign-in before they've created or accepted one).
 *
 * better-auth's organization plugin stores the active org on the session
 * row; the lookup is a single read.
 */
export async function requireActiveOrganization(auth: AuthGateway) {
  const session = await verifySession(auth)
  const tenantId = session.session.activeTenantId
  if (!tenantId) redirect('/menu/onboarding')
  return { session, tenantId }
}
