import 'server-only'
import { rotateJwks } from './use-cases/rotate-jwks'

/**
 * Per-process cron driver for slice-owned background jobs.
 *
 * Today the only job is JWKS rotation (every 90 days by default — the
 * use-case enforces the cadence; this driver just nudges it on a tight
 * cadence so a rotation never lands more than an hour past its window).
 *
 * Operational notes:
 *   - Wired from `src/instrumentation.ts` which Next 16 runs exactly once
 *     per Node process (and ONLY for `NEXT_RUNTIME === 'nodejs'`).
 *   - Idempotent: a second `startCron()` call is a no-op, so a stray
 *     lazy-import in the request path doesn't spin up duplicate timers.
 *   - Multi-replica safe: the rotation use-case takes
 *     `pg_advisory_xact_lock(JWKS_ROTATION_LOCK_KEY)` before deciding to
 *     insert, so even if N replicas all fire on the same hour boundary
 *     exactly one will rotate.
 *   - Verify the cron is running by tailing the app logs for
 *     `[cron] jwks rotated; new key <kid>` (only logs on actual rotation
 *     — the hourly no-op stays quiet so log volume is bounded).
 *   - To force a rotation outside the timer, use the admin "Rotate now"
 *     button at /admin/applications which calls the same use-case with
 *     `force: true`.
 */

let started = false

/** Idempotent: only the first call starts the timer. */
export function startCron(): void {
  if (started) return
  started = true

  const HOUR_MS = 60 * 60 * 1000

  // First check ~30s after boot so an initial deploy doesn't race the
  // migration container. setTimeout/setInterval keep the event loop alive
  // — that's fine here; the process is a long-running web server.
  setTimeout(() => {
    void runRotationOnce()
  }, 30_000).unref?.()

  // Hourly thereafter. The use-case decides whether to actually rotate
  // based on the 90-day recency guard, so this is effectively a "kick
  // the can" loop.
  setInterval(() => {
    void runRotationOnce()
  }, HOUR_MS).unref?.()
}

async function runRotationOnce(): Promise<void> {
  try {
    const result = await rotateJwks()
    if (!result.ok) {
      // Surface the failure — log loudly enough that an operator notices,
      // quietly enough that a transient blip doesn't page anyone. We log
      // at `error` so it's visible even with `logger.level = 'error'`
      // applied to Better Auth in production.
      console.error('[cron] jwks rotation failed:', result.error)
      return
    }
    if (result.rotated) {
      console.log('[cron] jwks rotated; new key', result.newKeyId)
    }
    // result.rotated === false (within recency window) → stay quiet so
    // log volume tracks rotations, not no-ops.
  } catch (err) {
    // Defensive — `rotateJwks` is supposed to swallow errors and return
    // `{ ok: false }`, but if anything escapes (e.g. a typo in a future
    // refactor that breaks the contract) we still don't want to crash
    // the Node process.
    console.error('[cron] jwks rotation crashed:', err)
  }
}
