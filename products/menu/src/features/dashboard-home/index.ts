import 'server-only'
import { cache } from 'react'
import { listRestaurants } from '../../shared/api'

/**
 * Public API of the dashboard-home slice — a thin loader over the Go
 * menu service. The Bearer token scopes the call to the active tenant,
 * so no tenantId parameter is needed. Wrapped in React's `cache()` so
 * the same call inside a single render (layout + page) hits the API
 * once.
 *
 * Per-restaurant menu summaries (the old `listMenusWithCounts`) come
 * straight from `requireRestaurantBySlug` / `getRestaurant(slug)` now —
 * the Go endpoint returns `{ restaurant, menus }` in one round-trip.
 */
export const listRestaurantsWithCounts = cache(async () => {
  const { restaurants } = await listRestaurants()
  return restaurants
})

export type { RestaurantSummary } from '../../shared/api'
