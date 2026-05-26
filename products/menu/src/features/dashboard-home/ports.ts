/**
 * DashboardReadPort — the slice's only dependency on the outside world.
 *
 * The dashboard home and the per-restaurant admin page render aggregate
 * "with counts" lists. These are cross-feature reads: a restaurant row
 * with its menu/dish counts, a menu row with its category/dish counts.
 * Keeping the I/O behind this port lets us swap the live DB for a fake
 * in unit tests.
 *
 * See `./adapters/drizzle.ts` for the production implementation and
 * `./use-cases/*` for callers.
 */

export type RestaurantWithCounts = {
  id: string
  name: string
  slug: string
  updatedAt: Date
  menuCount: number
  dishCount: number
}

export type MenuWithCounts = {
  id: string
  name: string
  active: boolean
  position: number
  updatedAt: Date
  categoryCount: number
  dishCount: number
}

export interface DashboardReadPort {
  /**
   * Lists the restaurants owned by an organization, with each one's menu and
   * dish counts. Caller is responsible for tenant gating before invoking this
   * (e.g. via `requireActiveOrganization`).
   */
  listRestaurantsWithCounts(
    organizationId: string,
  ): Promise<RestaurantWithCounts[]>

  /**
   * Lists the menus inside a restaurant with category and dish counts.
   * Caller must have already verified access to `restaurantId` (e.g. via
   * `requireRestaurantAccess` / `requireRestaurantBySlug`).
   */
  listMenusWithCounts(restaurantId: string): Promise<MenuWithCounts[]>
}
