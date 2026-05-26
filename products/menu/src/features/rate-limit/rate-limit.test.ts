/**
 * Real-Postgres tests for the sliding-window rate limiter.
 *
 * PGLite runs an actual Postgres-compatible engine in-process, so these
 * exercise the real `pg_advisory_xact_lock` semantics, transaction isolation,
 * timestamp comparisons, and index behavior — no Docker, no testcontainers,
 * no mocks. Same scenarios the previous Redis integration suite covered.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { eq, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

const { postgresLimiter } = await import('./adapters/postgres')
const { check } = await import('./use-cases/check')
import type { RateLimiter } from './ports'
import { POLICIES, type PolicyName } from './policies'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import { rateLimitEvent } from '@/shared/db/schema'

let t: TestDb
let limiter: RateLimiter

beforeEach(async () => {
  t = await makeTestDb()
  limiter = postgresLimiter(t.db)
})

afterEach(async () => {
  await t.cleanup()
})

describe('postgresLimiter — semantics', () => {
  it('allows up to the limit, denies over, refills after the window', async () => {
    const key = 'rl:test:basic'
    const windowMs = 1000

    for (let i = 0; i < 3; i++) {
      const d = await limiter.check(key, 3, windowMs)
      expect(d.ok).toBe(true)
    }

    const denied = await limiter.check(key, 3, windowMs)
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.retryAfterSec).toBeGreaterThan(0)
      expect(denied.retryAfterSec).toBeLessThanOrEqual(2)
    }

    await new Promise((r) => setTimeout(r, windowMs + 100))

    const refilled = await limiter.check(key, 3, windowMs)
    expect(refilled.ok).toBe(true)
  })

  it('isolates keys', async () => {
    const a1 = await limiter.check('rl:test:iso:a', 1, 60_000)
    const a2 = await limiter.check('rl:test:iso:a', 1, 60_000)
    const b1 = await limiter.check('rl:test:iso:b', 1, 60_000)
    expect(a1.ok).toBe(true)
    expect(a2.ok).toBe(false)
    expect(b1.ok).toBe(true)
  })

  it('is atomic under concurrent fire — exactly `limit` admitted of N parallel', async () => {
    const key = 'rl:test:concurrent'
    const LIMIT = 10
    const TOTAL = 50

    // Fire 50 in parallel. PGLite serialises connections but our adapter
    // uses pg_advisory_xact_lock(hashtext(key)) to guarantee per-key
    // serialization — even in a multi-connection Postgres, two concurrent
    // checks on the same key cannot both observe count < limit and both
    // INSERT past it. With READ COMMITTED + no lock this would slip.
    const results = await Promise.all(
      Array.from({ length: TOTAL }, () => limiter.check(key, LIMIT, 60_000)),
    )

    expect(results.filter((r) => r.ok).length).toBe(LIMIT)
    expect(results.filter((r) => !r.ok).length).toBe(TOTAL - LIMIT)
  })

  it('different keys do not serialise against each other', async () => {
    // Two keys → no advisory-lock contention → both fully admitted up to
    // their limits. Sanity check that the hashtext() lock scopes by key.
    const [a, b] = await Promise.all([
      Promise.all(
        Array.from({ length: 5 }, () =>
          limiter.check('rl:test:par:a', 5, 60_000),
        ),
      ),
      Promise.all(
        Array.from({ length: 5 }, () =>
          limiter.check('rl:test:par:b', 5, 60_000),
        ),
      ),
    ])
    expect(a.every((r) => r.ok)).toBe(true)
    expect(b.every((r) => r.ok)).toBe(true)
  })

  it('expired entries are pruned on each call (table stays bounded)', async () => {
    const key = 'rl:test:bound'
    const windowMs = 300

    for (let i = 0; i < 10; i++) {
      await limiter.check(key, 100, windowMs)
    }
    await new Promise((r) => setTimeout(r, windowMs + 50))
    for (let i = 0; i < 10; i++) {
      await limiter.check(key, 100, windowMs)
    }

    const [agg] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateLimitEvent)
      .where(eq(rateLimitEvent.key, key))
    // The first wave (10 rows) is older than (now - windowMs) by the time
    // the second wave starts, so each call in the second wave DELETEs the
    // first wave's leftovers before inserting. Only the second wave (± the
    // very last row's neighbour) survives.
    expect(agg!.count).toBeGreaterThanOrEqual(10)
    expect(agg!.count).toBeLessThanOrEqual(11)
  })

  it('retryAfterSec accurately reflects when the oldest entry expires', async () => {
    const key = 'rl:test:retryafter'
    const windowMs = 2000

    const start = Date.now()
    await limiter.check(key, 1, windowMs)
    const denied = await limiter.check(key, 1, windowMs)
    const elapsed = Date.now() - start

    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      const expectedSec = Math.ceil((windowMs - elapsed) / 1000)
      expect(denied.retryAfterSec).toBeGreaterThanOrEqual(expectedSec - 1)
      expect(denied.retryAfterSec).toBeLessThanOrEqual(expectedSec + 1)
    }
  })

  it('sustained traffic stays memory-bounded across many windows', async () => {
    const key = 'rl:test:sustained'
    const windowMs = 200
    const limit = 5

    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < limit; i++) {
        await limiter.check(key, limit, windowMs)
      }
      const [agg] = await t.db
        .select({ count: sql<number>`count(*)::int` })
        .from(rateLimitEvent)
        .where(eq(rateLimitEvent.key, key))
      // Each cycle: prune (drops previous cycle's rows) then insert `limit`
      // fresh rows. The bound is ~2× limit (one cycle in + tail of previous).
      expect(agg!.count).toBeLessThanOrEqual(limit * 2 + 1)
      await new Promise((r) => setTimeout(r, windowMs + 50))
    }
  })
})

describe('postgresLimiter — critical paths', () => {
  it('high parallelism across many keys → no cross-key blocking, no deadlock', async () => {
    // 100 distinct keys × 5 calls each = 500 calls fired with Promise.all.
    // If the advisory lock were global (instead of hashtext-per-key), this
    // would serialize and become very slow or deadlock. If it scopes
    // correctly, every call admits (limit=5/key, exactly 5 calls/key).
    //
    // This is the regression guard for the lock-distribution invariant —
    // change `hashtext(key)` to a constant and watch this test crawl.
    const KEYS = 100
    const PER_KEY = 5
    const t0 = Date.now()

    const ops = []
    for (let k = 0; k < KEYS; k++) {
      for (let i = 0; i < PER_KEY; i++) {
        ops.push(limiter.check(`rl:multi:${k}`, PER_KEY, 60_000))
      }
    }
    const results = await Promise.all(ops)
    const elapsed = Date.now() - t0

    expect(results.every((r) => r.ok)).toBe(true)
    expect(results).toHaveLength(KEYS * PER_KEY)
    // Generous bound — PGLite is single-threaded WASM, so this is mostly a
    // smoke test for catastrophic regressions (global lock would push 10s+).
    expect(elapsed).toBeLessThan(15_000)
  }, 30_000)

  it('every POLICY value round-trips through enforce → real Postgres → expected limit', async () => {
    // Spot-check every policy: fire `limit` calls, all admitted; fire one
    // more, denied. Catches mis-typed POLICIES entries (limit=0, swapped
    // limit/windowMs, etc.) before they ship.
    const policyNames = Object.keys(POLICIES) as PolicyName[]

    for (const name of policyNames) {
      const policy = POLICIES[name]
      const key = `rl:policy-test:${name}`

      for (let i = 0; i < policy.limit; i++) {
        const d = await check(limiter, key, policy)
        expect(d.ok).toBe(true)
      }
      const denied = await check(limiter, key, policy)
      expect(denied.ok).toBe(false)
    }
  }, 30_000)
})

describe('check — fail mode policy (adapter-error path)', () => {
  it('fail-closed: denies on adapter error', async () => {
    const broken: RateLimiter = {
      check: async () => {
        throw new Error('db down')
      },
    }
    const decision = await check(broken, 'rl:x:y', {
      name: 'x',
      limit: 1,
      windowMs: 1000,
      failClosed: true,
    })
    expect(decision.ok).toBe(false)
  })

  it('fail-open: allows on adapter error', async () => {
    const broken: RateLimiter = {
      check: async () => {
        throw new Error('db down')
      },
    }
    const decision = await check(broken, 'rl:x:y', {
      name: 'x',
      limit: 1,
      windowMs: 1000,
      failClosed: false,
    })
    expect(decision.ok).toBe(true)
  })
})
