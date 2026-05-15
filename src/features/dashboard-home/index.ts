import 'server-only'
import { cache } from 'react'
import { drizzleDashboardRead } from './adapters/drizzle'
import { listMenusWithCounts as _listMenusWithCounts } from './use-cases/list-menus-with-counts'
import { listRestaurantsWithCounts as _listRestaurantsWithCounts } from './use-cases/list-restaurants-with-counts'

/**
 * Public API of the dashboard-home slice. Convenience wrappers bind the
 * production `DashboardReadPort` and are wrapped in React's `cache()` so
 * the same call inside a single render hits the DB once.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `DashboardReadPort`.
 */
export const listRestaurantsWithCounts = cache((organizationId: string) =>
  _listRestaurantsWithCounts(drizzleDashboardRead, organizationId),
)

export const listMenusWithCounts = cache((restaurantId: string) =>
  _listMenusWithCounts(drizzleDashboardRead, restaurantId),
)

// Port + types are re-exported so other slices (menu-publishing wraps
// `listMenusWithCounts` in `unstable_cache`) can refer to them.
export type {
  DashboardReadPort,
  MenuWithCounts,
  RestaurantWithCounts,
} from './ports'
