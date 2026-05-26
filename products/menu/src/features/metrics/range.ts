/**
 * Pure date/bucket helpers for the metrics slice. No I/O, safe to import
 * anywhere. The `YYYY-MM-DD` UTC string is the canonical day key used by
 * the `daily_view` table — keep this file the single source of bucketing
 * truth so the beacon and the analytics reader can't drift apart.
 */

export type AnalyticsRange = 'today' | '7d' | '30d'

export const ANALYTICS_RANGES: AnalyticsRange[] = ['today', '7d', '30d']

export function isAnalyticsRange(value: string): value is AnalyticsRange {
  return (ANALYTICS_RANGES as string[]).includes(value)
}

/** UTC `YYYY-MM-DD` for a given Date — single source of truth for bucketing. */
export function toDayString(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function shiftDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

export function rangeBounds(range: AnalyticsRange, now = new Date()) {
  const today = toDayString(now)
  if (range === 'today') {
    return { start: today, end: today, span: 1 }
  }
  const span = range === '7d' ? 7 : 30
  return {
    start: toDayString(shiftDays(now, -(span - 1))),
    end: today,
    span,
  }
}

export function currentMonthBounds(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return {
    start: toDayString(new Date(Date.UTC(y, m, 1))),
    end: toDayString(new Date(Date.UTC(y, m + 1, 0))),
  }
}
