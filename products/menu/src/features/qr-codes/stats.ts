import type { QrCodeListRow } from './ports'

/**
 * Pure-function summariser for the QR admin overview strip. Same
 * shape as the sessions slice's `computeSessionStats` — small,
 * serialisable, framework-free. The admin page calls it with the full
 * registry; for 10k+ codes a future paginated view would compute
 * stats DB-side, but for the current scale the round-trip + map is
 * fine.
 */

export type QrStats = {
  /** Total rows in the registry. */
  total: number
  /** Codes bound to a restaurant. */
  bound: number
  /** Codes still unbound — ready to claim. */
  unbound: number
  /** Codes carrying an administrative label. */
  withLabel: number
  /** Codes created in the last 24h — proxy for "new minting today". */
  created24h: number
  /** Codes whose first binding happened in the last 24h. */
  boundLast24h: number
  /** Top 5 restaurants by number of bound codes, desc. */
  topRestaurants: Array<{ name: string; count: number }>
}

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

export function computeQrStats(
  rows: ReadonlyArray<QrCodeListRow>,
  now: Date = new Date(),
): QrStats {
  const nowMs = now.getTime()
  let bound = 0
  let withLabel = 0
  let created24h = 0
  let boundLast24h = 0
  const restaurantCounts = new Map<string, number>()

  for (const r of rows) {
    if (r.restaurantId) {
      bound++
      const name = r.restaurant?.name ?? r.restaurantId
      restaurantCounts.set(name, (restaurantCounts.get(name) ?? 0) + 1)
    }
    if (r.label && r.label.trim()) withLabel++
    if (nowMs - r.createdAt.getTime() <= FRESH_WINDOW_MS) created24h++
    if (r.boundAt && nowMs - r.boundAt.getTime() <= FRESH_WINDOW_MS) {
      boundLast24h++
    }
  }

  const topRestaurants = [...restaurantCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5)

  return {
    total: rows.length,
    bound,
    unbound: rows.length - bound,
    withLabel,
    created24h,
    boundLast24h,
    topRestaurants,
  }
}
