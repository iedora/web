import 'server-only'
import type { DashboardReadPort, MenuWithCounts } from '../ports'

/**
 * Lists the menus inside a restaurant with category and dish counts.
 * Backs the per-restaurant admin landing page (`/dashboard/r/[slug]`),
 * which is wrapped in `loadRestaurantAdminMenus` (menu-publishing) for
 * `unstable_cache` + per-slug tag.
 *
 * Auth: caller must have already verified access to `restaurantId` via
 * `requireRestaurantAccess` / `requireRestaurantBySlug`.
 */
export async function listMenusWithCounts(
  dashboard: DashboardReadPort,
  restaurantId: string,
): Promise<MenuWithCounts[]> {
  return dashboard.listMenusWithCounts(restaurantId)
}
