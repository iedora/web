import 'server-only'
import type { APIRequestContext } from '@playwright/test'
import { testDb } from './e2e-db'

/**
 * Zero-domain helpers for the public view-tracking beacon
 * (`/api/track/[slug]`). The visitor cookie name is mirrored from the
 * production route — see `src/app/api/track/[slug]/route.ts`. If that
 * cookie name ever changes, change it here too.
 */

export const VISITOR_COOKIE = 'mm_v'

export type FireBeaconOptions = {
  visitorId?: string
  userAgent?: string
}

/**
 * Hit the beacon endpoint once. By default uses the request context's
 * own UA + visitor cookie; pass `visitorId` to dedupe explicitly or
 * `userAgent` to simulate a bot (the route filters obvious bot UAs).
 */
export async function fireBeacon(
  request: APIRequestContext,
  slug: string,
  opts: FireBeaconOptions = {},
): Promise<number> {
  const headers: Record<string, string> = {}
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent
  if (opts.visitorId) headers['Cookie'] = `${VISITOR_COOKIE}=${opts.visitorId}`
  const res = await request.get(`/api/track/${slug}`, { headers })
  return res.status()
}

/**
 * Poll until at least one daily_view row exists for the given restaurant.
 * Returns the aggregate count. Throws if no view appears within `timeoutMs`.
 */
export async function waitForView(
  restaurantId: string,
  { timeoutMs = 2_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ count: number }> {
  const sql = testDb()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await sql<{ count: number }[]>`
      SELECT COALESCE(SUM(count), 0)::int AS count
      FROM "menu"."daily_view"
      WHERE restaurant_id = ${restaurantId}
    `
    if (row && row.count > 0) return row
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `waitForView: no daily_view row for restaurantId=${restaurantId} within ${timeoutMs}ms`,
  )
}
