import type { LanguageCode } from '@/features/i18n'
import type { AnalyticsRange } from './range'

export type DailyPoint = { day: string; count: number }

export type OrgAnalytics = {
  range: AnalyticsRange
  /** Total scans in the selected range. */
  totalScans: number
  /** Scans on the current day only — surfaced as a tagline on the SCAN card. */
  todayScans: number
  /** One point per day in the range, oldest first. Zero-days included so the
   *  sparkline length always matches the range. Empty for `range === 'today'`
   *  (single-day chart isn't useful). */
  dailyBreakdown: DailyPoint[]
  /** Org-wide content state — independent of the analytics range. */
  menus: { total: number; active: number; paused: number }
  dishes: { total: number; lastAddedAt: Date | null }
  /** Union of every restaurant's `supportedLanguages` in the org, in registry
   *  order (deduped). */
  languageCodes: LanguageCode[]
}

/** One row of the per-day breakdown returned by the gateway. */
export type DailyBreakdownRow = { day: string; count: number }

/** Org-wide content state used by the analytics reader. */
export type OrgContentSnapshot = {
  menus: { active: boolean | null; n: number }[]
  dishes: { n: number; lastAddedAt: Date | null }
  supportedLanguageSets: LanguageCode[][]
}
