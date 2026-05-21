import type { SessionRecord } from './ports'

/**
 * Pure-function summariser for the admin UI. The admin page calls it
 * with the full `listAllActive()` result + the current wall clock; the
 * shape is small and serialisable so it crosses the RSC boundary
 * cheaply.
 *
 * Stays framework-free + side-effect-free → directly unit-testable.
 */

export type SessionStats = {
  /** Active session rows. */
  total: number
  /** Distinct user ids. Sessions / users gives "avg devices per user". */
  uniqueUsers: number
  /** Sessions created in the last 24h — proxy for daily new logins. */
  last24h: number
  /** Sessions whose `lastSeenAt` is older than 24h — likely abandoned. */
  staleCount: number
  /** Mean of `now - lastSeenAt`, in hours. NaN if no rows. */
  avgAgeHours: number
  /** Browser histogram, sorted by count desc. */
  browsers: Array<{ name: string; count: number }>
  /** OS histogram, sorted by count desc. */
  operatingSystems: Array<{ name: string; count: number }>
  /** Permission-version histogram — versions > 1 indicate sessions whose
   *  scope set was rewritten in-flight (webhook fan-out). */
  permissionVersionMax: number
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const FRESH_LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000

export function computeSessionStats(
  rows: ReadonlyArray<SessionRecord>,
  now: Date = new Date(),
): SessionStats {
  const nowMs = now.getTime()
  const userIds = new Set<string>()
  const browserCounts = new Map<string, number>()
  const osCounts = new Map<string, number>()
  let last24h = 0
  let staleCount = 0
  let ageSumMs = 0
  let permissionVersionMax = 0

  for (const r of rows) {
    userIds.add(r.userId)
    const created = r.createdAt.getTime()
    if (nowMs - created <= FRESH_LOGIN_WINDOW_MS) last24h++
    const ageMs = nowMs - r.lastSeenAt.getTime()
    if (ageMs > STALE_AFTER_MS) staleCount++
    ageSumMs += ageMs
    if (r.permissionsVersion > permissionVersionMax) {
      permissionVersionMax = r.permissionsVersion
    }
    const browser = parseBrowser(r.userAgent)
    browserCounts.set(browser, (browserCounts.get(browser) ?? 0) + 1)
    const os = parseOs(r.userAgent)
    osCounts.set(os, (osCounts.get(os) ?? 0) + 1)
  }

  return {
    total: rows.length,
    uniqueUsers: userIds.size,
    last24h,
    staleCount,
    avgAgeHours: rows.length === 0 ? NaN : ageSumMs / rows.length / 3_600_000,
    browsers: histogramToList(browserCounts),
    operatingSystems: histogramToList(osCounts),
    permissionVersionMax,
  }
}

/**
 * The same lightweight UA sniffing the table cell uses — duplicated
 * deliberately so stats stay framework-free. Keep in sync.
 */
function parseBrowser(raw: string | null): string {
  if (!raw) return 'Unknown'
  if (/Edg\/\d/.test(raw)) return 'Edge'
  if (/OPR\/\d|Opera\/\d/.test(raw)) return 'Opera'
  if (/Chrome\/\d/.test(raw)) return 'Chrome'
  if (/Firefox\/\d/.test(raw)) return 'Firefox'
  if (/Safari\/\d/.test(raw) && !/Chrome/.test(raw)) return 'Safari'
  return 'Other'
}

function parseOs(raw: string | null): string {
  if (!raw) return 'Unknown'
  if (/iPhone|iPad/.test(raw)) return 'iOS'
  if (/Android/.test(raw)) return 'Android'
  if (/Mac OS X/.test(raw)) return 'macOS'
  if (/Windows/.test(raw)) return 'Windows'
  if (/Linux/.test(raw)) return 'Linux'
  return 'Other'
}

function histogramToList(
  m: Map<string, number>,
): Array<{ name: string; count: number }> {
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
