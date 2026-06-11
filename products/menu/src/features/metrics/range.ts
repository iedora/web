/**
 * Analytics range registry — MUST stay in sync with the Go service's
 * `AnalyticsRanges` map (services/internal/menu/views.go), which is the
 * authority: an unknown range key 400s there.
 */

export type AnalyticsRange = 'today' | '7d' | '30d'

export const ANALYTICS_RANGES: AnalyticsRange[] = ['today', '7d', '30d']

export function isAnalyticsRange(value: string): value is AnalyticsRange {
  return (ANALYTICS_RANGES as string[]).includes(value)
}
