import 'server-only'
import type { DashboardReadPort, RestaurantWithCounts } from '../ports'

/**
 * Lists the restaurants owned by an organization, with menu and dish counts
 * per restaurant. The dashboard home renders one row per restaurant.
 *
 * Auth: caller must have already verified the active org (e.g. via
 * `requireActiveOrganization`). This use-case is a thin pass-through over
 * the gateway — the join logic lives in the adapter.
 */
export async function listRestaurantsWithCounts(
  dashboard: DashboardReadPort,
  organizationId: string,
): Promise<RestaurantWithCounts[]> {
  return dashboard.listRestaurantsWithCounts(organizationId)
}
