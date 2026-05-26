import 'server-only'
import { cache } from 'react'
import { meter, tenantAttributes } from '@iedora/observability'
import type { LanguageCode } from '@/features/i18n'
import { drizzleMetrics } from './adapters/drizzle'
import { getOrganizationAnalytics as _getOrganizationAnalytics } from './use-cases/get-organization-analytics'
import { getOrganizationMonthlyViews as _getOrganizationMonthlyViews } from './use-cases/get-organization-monthly-views'
import { incrementDailyView as _incrementDailyView } from './use-cases/increment-daily-view'
import type { AnalyticsRange } from './range'

/**
 * Counter for newly tracked public-menu views (deduped per
 * (visitor, restaurant, hour) — see AGENTS.md hard rule #13). Created
 * lazily at module load via the global iedora Meter; safe even before
 * `registerIedoraOtel` has run (no-op meter degrades cleanly).
 *
 * Labels are tenant attributes (restaurant_id, organization_id) plus
 * the language picked at render time. Language fanout is bounded by the
 * language registry (en/pt/es/fr today, ~10 long-term) so it's safe to
 * tag without blowing up cardinality.
 *
 * Single source of truth: this counter is incremented at the SAME chokepoint
 * that writes the daily_view row — so the metric and the table stay in sync
 * even if either backend goes through a re-aggregation.
 */
const restaurantViewsCounter = meter.createCounter('iedora.restaurant_views_total', {
  description:
    'Newly tracked public-menu views (deduped per visitor/restaurant/hour). One per real, non-bot visit to a public menu page.',
  unit: 'view',
})

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

export const incrementDailyView = async (
  restaurantId: string,
  organizationId: string,
  language: LanguageCode,
) => {
  // Increment the OTel counter FIRST, before the DB write. Two reasons:
  //   1. The counter `.add()` is synchronous and cheap (in-process buffer);
  //      if the DB upsert throws, we still recorded the view at the metric
  //      level — useful for noticing "DB writes failing but visitors still
  //      arriving" via metric vs row-count divergence.
  //   2. The caller already verified this is a newly-tracked view (the
  //      route's view_seen onConflictDoNothing returned an inserted row),
  //      so the count is meaningful — no double-counting on dedupe path.
  restaurantViewsCounter.add(
    1,
    {
      ...tenantAttributes({ restaurantId, organizationId }),
      'iedora.language': language,
    },
  )
  await _incrementDailyView(drizzleMetrics, restaurantId, organizationId, language)
}

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
