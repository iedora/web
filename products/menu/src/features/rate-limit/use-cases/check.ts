import type { Policy } from '../policies'
import type { RateLimitDecision, RateLimiter } from '../ports'

/**
 * Pure entry point — applies a policy against a port. The port handles its
 * own connection errors and surfaces them via the `failClosed` flag.
 *
 * Tests bind a mock port directly. Production callers go through the
 * slice barrel's `enforceRateLimit` which is bound to the Postgres adapter.
 */
export async function check(
  port: RateLimiter,
  key: string,
  policy: Policy,
): Promise<RateLimitDecision> {
  try {
    return await port.check(key, policy.limit, policy.windowMs)
  } catch (err) {
    if (policy.failClosed) {
      console.warn(`[rate-limit] ${policy.name} fail-closed:`, (err as Error).message)
      return { ok: false, retryAfterSec: 1 }
    }
    return { ok: true, remaining: -1, resetAt: 0 }
  }
}
