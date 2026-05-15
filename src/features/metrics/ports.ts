import type { LanguageCode } from '@/features/i18n'
import type { DailyBreakdownRow, OrgContentSnapshot } from './types'

/**
 * MetricsGateway — the slice's only dependency on the outside world.
 *
 * Use-cases call methods on this interface; production wires it to
 * `drizzleMetrics` (Drizzle + Postgres). Tests wire fakes against PGLite.
 *
 * Keep this surface minimal: just the I/O the beacon write + the analytics
 * reads need. The day bucketing lives in `range.ts` and is computed by the
 * use-cases — the gateway only needs raw strings.
 */
export interface MetricsGateway {
  /**
   * Upserts the per-day scan count for a restaurant+language tuple. Increments
   * the existing row's `count` by one when a conflict on
   * `(restaurantId, day, language)` is hit. Atomic — preserves the
   * beacon's hard-rule-#13 semantics.
   */
  incrementDailyView(input: {
    restaurantId: string
    organizationId: string
    day: string
    language: LanguageCode
  }): Promise<void>

  /**
   * Sums `daily_view.count` for an organization across a closed day range.
   * Returns 0 when no rows match.
   */
  sumScans(organizationId: string, start: string, end: string): Promise<number>

  /**
   * Per-day grouped scan totals for an organization, inclusive on both bounds.
   * Gaps (zero-scan days) are NOT filled — the caller stitches the timeline.
   */
  dailyBreakdown(
    organizationId: string,
    start: string,
    end: string,
  ): Promise<DailyBreakdownRow[]>

  /**
   * Org-wide content state: menu counts (split by active flag), dish count +
   * last-added timestamp, and every restaurant's `supportedLanguages` array.
   * Single round-trip per call site; the analytics reader runs this in
   * parallel with the scan queries.
   */
  getOrgContent(organizationId: string): Promise<OrgContentSnapshot>
}
