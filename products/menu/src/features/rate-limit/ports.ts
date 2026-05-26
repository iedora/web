export type RateLimitDecision =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterSec: number }

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>
}
