import 'server-only'
import { cache } from 'react'
import type { LanguageCode } from '@/features/i18n'
import { drizzleMetrics } from './adapters/drizzle'
import { getOrganizationAnalytics as _getOrganizationAnalytics } from './use-cases/get-organization-analytics'
import { getOrganizationMonthlyViews as _getOrganizationMonthlyViews } from './use-cases/get-organization-monthly-views'
import { incrementDailyView as _incrementDailyView } from './use-cases/increment-daily-view'
import type { AnalyticsRange } from './range'

/**
 * Public API of the metrics slice. These convenience wrappers bind the
 * production MetricsGateway. Read functions are wrapped in React's `cache()`
 * so repeated calls during a single render hit the DB once.
 *
 * The beacon write (`incrementDailyView`) is intentionally NOT memoized —
 * it's a write, and the route fires it at most once per qualifying request.
 *
 * For unit tests, import the use-case functions directly from
 * `./use-cases/*` and pass a fake `MetricsGateway`.
 */
export const getOrganizationMonthlyViews = cache((organizationId: string) =>
  _getOrganizationMonthlyViews(drizzleMetrics, organizationId),
)

export const getOrganizationAnalytics = cache(
  (organizationId: string, range: AnalyticsRange) =>
    _getOrganizationAnalytics(drizzleMetrics, organizationId, range),
)

export const incrementDailyView = (
  restaurantId: string,
  organizationId: string,
  language: LanguageCode,
) =>
  _incrementDailyView(drizzleMetrics, restaurantId, organizationId, language)

// Pure helpers (no I/O) re-exported directly.
export {
  ANALYTICS_RANGES,
  currentMonthBounds,
  isAnalyticsRange,
  rangeBounds,
  toDayString,
} from './range'
export type { AnalyticsRange } from './range'
export type { DailyPoint, OrgAnalytics } from './types'
export type { MetricsGateway } from './ports'
