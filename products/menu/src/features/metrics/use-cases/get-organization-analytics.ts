import 'server-only'
import type { LanguageCode } from '@/features/i18n'
import type { MetricsGateway } from '../ports'
import {
  rangeBounds,
  shiftDays,
  toDayString,
  type AnalyticsRange,
} from '../range'
import type { DailyPoint, OrgAnalytics } from '../types'

/**
 * One round-trip per panel; the panels are independent so we run them in
 * parallel. The page render is server-side, so a `Promise.all` is the cheap
 * way to keep the dashboard's first-byte close to the slowest single query.
 */
export async function getOrganizationAnalytics(
  metrics: MetricsGateway,
  organizationId: string,
  range: AnalyticsRange,
): Promise<OrgAnalytics> {
  const { start, end, span } = rangeBounds(range)
  const today = toDayString()

  const [totalScans, todayScans, breakdownRows, content] = await Promise.all([
    metrics.sumScans(organizationId, start, end),
    metrics.sumScans(organizationId, today, today),
    span > 1
      ? metrics.dailyBreakdown(organizationId, start, end)
      : Promise.resolve([] as { day: string; count: number }[]),
    metrics.getOrgContent(organizationId),
  ])

  const dailyBreakdown =
    span > 1 ? fillDailyGaps(breakdownRows, start, span) : []

  const menus = {
    total: content.menus.reduce((sum, r) => sum + r.n, 0),
    active: content.menus.find((r) => r.active === true)?.n ?? 0,
    paused: content.menus.find((r) => r.active === false)?.n ?? 0,
  }

  const dishes = {
    total: content.dishes.n,
    lastAddedAt: content.dishes.lastAddedAt,
  }

  // Union the per-restaurant supportedLanguages arrays. Set keeps dedup; the
  // page can sort by registry order if it cares — we avoid importing the
  // language registry here to keep the slice's dep graph thin.
  const languageSet = new Set<LanguageCode>()
  for (const codes of content.supportedLanguageSets) {
    for (const code of codes) languageSet.add(code)
  }

  return {
    range,
    totalScans,
    todayScans,
    dailyBreakdown,
    menus,
    dishes,
    languageCodes: Array.from(languageSet),
  }
}

function fillDailyGaps(
  rows: { day: string; count: number }[],
  start: string,
  span: number,
): DailyPoint[] {
  const map = new Map(rows.map((r) => [r.day, Number(r.count)]))
  const out: DailyPoint[] = []
  // `start` is `YYYY-MM-DD`; reconstruct as a UTC date so DST boundaries
  // never shift the bucket walk.
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const startDate = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < span; i++) {
    const day = toDayString(shiftDays(startDate, i))
    out.push({ day, count: map.get(day) ?? 0 })
  }
  return out
}
