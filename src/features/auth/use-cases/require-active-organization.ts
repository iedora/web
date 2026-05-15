import 'server-only'
import { redirect } from 'next/navigation'
import type { AuthGateway } from '../ports'
import { verifySession } from './verify-session'
import { getEffectiveOrganizationId } from './get-effective-organization-id'

/**
 * Guarantees an authenticated session AND a resolved organizationId. Redirects
 * to /onboarding when the user has no organizations yet. Returns both so
 * downstream guards don't need to re-query.
 */
export async function requireActiveOrganization(auth: AuthGateway) {
  const session = await verifySession(auth)
  const organizationId = await getEffectiveOrganizationId(
    auth,
    session.user.id,
    session.session.activeOrganizationId,
  )
  if (!organizationId) redirect('/onboarding')
  return { session, organizationId }
}
