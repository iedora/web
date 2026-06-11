import 'server-only'
import { cache } from 'react'
import { getAnalytics, getMonthlyViews } from '../../shared/api'
import type { AnalyticsRange } from './range'

/**
 * Public API of the metrics slice — thin read loaders over the Go menu
 * service. The Bearer token scopes both calls to the active tenant, so
 * no tenantId parameter is needed. Wrapped in React's `cache()` so
 * repeated calls during a single render hit the API once.
 *
 * View tracking (the old `incrementDailyView`) lives entirely in the
 * Go service's public track beacon now — this slice only reads.
 */
export const getOrganizationMonthlyViews = cache(async () => {
  const { count } = await getMonthlyViews()
  return count
})

export const getOrganizationAnalytics = cache((range: AnalyticsRange) =>
  getAnalytics(range),
)

// Pure helpers (no I/O) re-exported directly.
export { ANALYTICS_RANGES, isAnalyticsRange } from './range'
export type { AnalyticsRange } from './range'
export type { Analytics, DailyPoint } from '../../shared/api'
