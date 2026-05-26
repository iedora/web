import 'server-only'
import { db } from '@/shared/db/client'
import { env } from '@/shared/env'
import { postgresLimiter } from './adapters/postgres'
import { POLICIES, type Policy, type PolicyName } from './policies'
import type { RateLimitDecision } from './ports'
import { check } from './use-cases/check'

const limiter = postgresLimiter(db)

const DISABLED = env.DISABLE_RATE_LIMIT === 'true'

/**
 * Production entry point — bind the policy by name + caller-supplied actor.
 *
 *   const decision = await enforceRateLimit('presign', `org:${orgId}`)
 *   if (!decision.ok) return { ok: false, error: `Try again in ${decision.retryAfterSec}s` }
 *
 * Key shape: `rl:{policy}:{actor}`. `actor` is whatever bucket you want to
 * throttle on — `org:{orgId}`, `user:{userId}`, `ip:{normalizedIp}`.
 *
 * Honor the `DISABLE_RATE_LIMIT=true` env knob so e2e tests don't trip the
 * limiter when they create users / upload assets in a tight loop.
 */
export async function enforceRateLimit(
  policyName: PolicyName,
  actor: string,
): Promise<RateLimitDecision> {
  if (DISABLED) return { ok: true, remaining: -1, resetAt: 0 }
  const policy: Policy = POLICIES[policyName]
  return check(limiter, `rl:${policy.name}:${actor}`, policy)
}

export { extractClientIp } from './ip'
export { POLICIES, type PolicyName } from './policies'
export type { RateLimitDecision, RateLimiter } from './ports'
