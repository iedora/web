/**
 * Row shapes + pure stats for the QR slice. Kept out of `index.ts`
 * (which is `server-only`) so the client admin UI can import the types
 * and the stats math without dragging server modules into the bundle.
 *
 * `QrCodeListRow` is the Go `QRCode` DTO (shared/api.ts) normalised for
 * rendering: ISO-string dates, explicit nulls, and the bound restaurant
 * folded into a nested object like the old Drizzle join produced.
 */

export type QrCodeListRow = {
  code: string
  restaurantId: string | null
  label: string | null
  /** ISO timestamp. */
  createdAt: string
  /** ISO timestamp, null while unbound. */
  boundAt: string | null
  restaurant: { id: string; name: string; slug: string } | null
}

/**
 * Pure-function summariser for the QR admin overview strip. Small,
 * serialisable, framework-free. The admin page calls it with the full
 * registry; for 10k+ codes a future paginated view would compute
 * stats server-side, but for the current scale the round-trip + map is
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
    if (nowMs - Date.parse(r.createdAt) <= FRESH_WINDOW_MS) created24h++
    if (r.boundAt && nowMs - Date.parse(r.boundAt) <= FRESH_WINDOW_MS) {
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
