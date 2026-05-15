import 'server-only'
import { redirect } from 'next/navigation'
import type { AuthGateway } from '../ports'
import { requireActiveOrganization } from './require-active-organization'

/**
 * Tenant-scoped guard: verifies the caller is a member of the org that owns
 * the given restaurant. Redirects to /dashboard when the join fails (the
 * caller has no business seeing this restaurant). Returns the session,
 * organizationId, and restaurantId for downstream queries.
 */
export async function requireRestaurantAccess(auth: AuthGateway, restaurantId: string) {
  const { session, organizationId } = await requireActiveOrganization(auth)
  const row = await auth.findRestaurantByIdInOrg({
    restaurantId,
    organizationId,
    userId: session.user.id,
  })
  if (!row) redirect('/dashboard')
  return { session, organizationId, restaurantId }
}
