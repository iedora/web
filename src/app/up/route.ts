import { sql } from 'drizzle-orm'
import { db } from '@/shared/db/client'

/**
 * Healthcheck endpoint. Used by kamal-proxy as `proxy.healthcheck.path`.
 * Returns 200 only if the DB answers `SELECT 1` within 2 seconds.
 * Bypasses every cache via `force-dynamic` so the proxy poll always reaches origin.
 * No tenant tables (restaurant/menu/category/item) are touched, so the
 * `requireRestaurantAccess` rule in AGENTS.md does not apply — this route is
 * intentionally unauthenticated and must stay that way.
 */

export const dynamic = 'force-dynamic'

const DB_TIMEOUT_MS = 2000

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`db ping timed out after ${ms}ms`)), ms)
  })
}

export async function GET(): Promise<Response> {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      timeout(DB_TIMEOUT_MS),
    ])
  } catch (err) {
    const message =
      err instanceof Error ? err.message.split('\n')[0] : 'db unreachable'
    return Response.json(
      { ok: false, error: message },
      {
        status: 503,
        headers: { 'cache-control': 'no-store, max-age=0' },
      },
    )
  }

  return Response.json(
    { ok: true, db: 'ok' },
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  )
}
