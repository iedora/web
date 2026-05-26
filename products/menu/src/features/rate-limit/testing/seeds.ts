import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'

/**
 * Inject prior rate-limit events so a spec doesn't need to fire N real
 * requests to push the window over the limit. `occurredAt` defaults to
 * "just now" so events are inside any sane sliding-window.
 */
export async function seedRateLimitEvents(
  key: string,
  count: number,
  occurredAt: Date = new Date(),
): Promise<void> {
  const sql = testDb()
  for (let i = 0; i < count; i++) {
    await sql`
      INSERT INTO "menu"."rate_limit_event" (key, occurred_at)
      VALUES (${key}, ${new Date(occurredAt.getTime() - i)})
    `
  }
}
