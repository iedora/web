import 'server-only'
import { and, eq, lt, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { SpanStatusCode } from '@opentelemetry/api'
import { meter, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import type * as schema from '@/shared/db/schema'
import { rateLimitEvent } from '@/shared/db/schema'
import type { RateLimitDecision, RateLimiter } from '../ports'

/**
 * Time spent inside the per-key advisory-lock transaction. Long tail
 * here = same-key contention (e.g. one tenant hammering a single
 * endpoint). The `iedora.rate_limit.policy` label is derived from the
 * key prefix (`presign:r_X`, `commit:r_X`, …) so dashboards can break
 * down by policy without parsing the raw key. Restaurant IDs are
 * extracted into `iedora.restaurant_id` for tenant-scoped views.
 */
const rateLimitCheckDuration = meter.createHistogram(
  'iedora.rate_limit.check_duration_ms',
  {
    description:
      'Latency of postgresLimiter.check (advisory-lock transaction). Long tail = same-key contention.',
    unit: 'ms',
  },
)

/**
 * Decision counter. Bucketed by policy + outcome (allow|deny). Track
 * deny / total ratio per policy to spot policies that are too aggressive
 * or too permissive.
 */
const rateLimitDecisions = meter.createCounter(
  'iedora.rate_limit.decisions_total',
  {
    description:
      'Rate-limit decisions by policy and outcome (allow | deny).',
    unit: 'decision',
  },
)

/**
 * Derive a policy label from the rate-limit key. The key convention is
 * `${policy}:${scopeId}` (e.g. `presign:r_abc123`). Falls back to "other"
 * for keys that don't match — better than blank labels in the dashboard.
 */
function policyFromKey(key: string): string {
  const idx = key.indexOf(':')
  if (idx <= 0) return 'other'
  return key.slice(0, idx)
}

/**
 * Best-effort restaurant ID extraction. Same convention as the policy:
 * `${policy}:r_${id}` for restaurant-scoped policies. Returns null when
 * the key doesn't carry a restaurant scope (org-scoped or global policies).
 */
function restaurantIdFromKey(key: string): string | null {
  const m = key.match(/:(r_[a-zA-Z0-9]+)(?:$|:)/)
  return m?.[1] ?? null
}

// Generic over the driver — accepts both `postgres-js` (production) and
// PGLite (tests). Same surface, different transport.
type LimiterDb = PgDatabase<PgQueryResultHKT, typeof schema>

/**
 * Sliding-window rate limiter backed by a single Postgres table.
 *
 * Layout: `rate_limit_event(key, occurred_at)` with index `(key, occurred_at)`.
 * Each check, inside ONE transaction guarded by a per-key advisory lock:
 *   1. `pg_advisory_xact_lock(hashtext(key))`  ─ serialize same-key calls
 *   2. DELETE expired entries (`occurred_at < now - window`)
 *   3. INSERT a new row for this attempt
 *   4. SELECT count → decide allow/deny
 *
 * The advisory lock is the key piece — without it, two concurrent calls on
 * the same key under READ COMMITTED can both see "count < limit" and both
 * insert, allowing `limit + 1` admissions. With it, calls on different keys
 * never contend (hashtext distributes), and calls on the same key serialize
 * for the duration of the transaction. Equivalent atomicity to the Redis
 * MULTI block this replaces.
 *
 * Per-call cleanup keeps the table small without a separate VACUUM cron: at
 * steady state, a single key holds at most `limit` rows (current window) +
 * whatever this very call added.
 */
export function postgresLimiter(db: LimiterDb): RateLimiter {
  return {
    async check(key, limit, windowMs): Promise<RateLimitDecision> {
      return tracer.startActiveSpan('rate-limit.check', async (span) => {
        const policy = policyFromKey(key)
        const restaurantId = restaurantIdFromKey(key)
        span.setAttribute('iedora.rate_limit.policy', policy)
        if (restaurantId) span.setAttribute(IEDORA_RESTAURANT_ID, restaurantId)
        span.setAttribute('iedora.rate_limit.limit', limit)
        span.setAttribute('iedora.rate_limit.window_ms', windowMs)

        const now = Date.now()
        const cutoff = new Date(now - windowMs)
        const startedAt = performance.now()
        let outcome: 'allow' | 'deny' = 'allow'
        try {
          const decision = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)

            await tx
              .delete(rateLimitEvent)
              .where(
                and(
                  eq(rateLimitEvent.key, key),
                  lt(rateLimitEvent.occurredAt, cutoff),
                ),
              )

            await tx
              .insert(rateLimitEvent)
              .values({ key, occurredAt: new Date(now) })

            const [row] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(rateLimitEvent)
              .where(eq(rateLimitEvent.key, key))
            const count = row?.count ?? 0

            if (count > limit) {
              const [oldest] = await tx
                .select({ at: rateLimitEvent.occurredAt })
                .from(rateLimitEvent)
                .where(eq(rateLimitEvent.key, key))
                .orderBy(rateLimitEvent.occurredAt)
                .limit(1)
              const oldestMs = oldest?.at.getTime() ?? now
              const retryAfterMs = Math.max(1, oldestMs + windowMs - now)
              return {
                ok: false as const,
                retryAfterSec: Math.ceil(retryAfterMs / 1000),
              }
            }

            return {
              ok: true as const,
              remaining: Math.max(0, limit - count),
              resetAt: now + windowMs,
            }
          })
          outcome = decision.ok ? 'allow' : 'deny'
          span.setAttribute('iedora.rate_limit.outcome', outcome)
          return decision
        } catch (err) {
          span.recordException(err as Error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          })
          throw err
        } finally {
          const labels = {
            'iedora.rate_limit.policy': policy,
            'iedora.rate_limit.outcome': outcome,
          }
          rateLimitCheckDuration.record(performance.now() - startedAt, labels)
          rateLimitDecisions.add(1, labels)
          span.end()
        }
      })
    },
  }
}
