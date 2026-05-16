/**
 * Adapter-wiring regression: catches "model X not found in the schema object"
 * errors at PR time instead of in production on the first auth request.
 *
 * Background: Better Auth's `drizzleAdapter` takes an explicit `schema` dict
 * mapping model names → table objects. If our codebase adds a Better Auth
 * plugin (or a storage option) that introduces a new model and we forget to
 * register it in BA_MODELS, the app deploys fine — schema/migration are
 * separate from the adapter dict — but the FIRST auth request that hits the
 * missing model throws. That's exactly what we shipped + had to hotfix when
 * the rate_limit table was added without registering it.
 *
 * Two layers of defence here:
 *   1. Static: BA_MODELS contains every key the rest of the codebase agreed
 *      Better Auth needs. Diverges → fails fast.
 *   2. Runtime: build a real BA instance against PGLite, exercise it. If a
 *      model is missing from BA_MODELS (and therefore from the adapter
 *      dict), the BA call throws the canonical error.
 */
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test'
process.env.BETTER_AUTH_SECRET ||= 'x'.repeat(32)
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'
process.env.S3_ENDPOINT ||= 'http://localhost:4566'
process.env.S3_REGION ||= 'us-east-1'
process.env.S3_ACCESS_KEY ||= 'test'
process.env.S3_SECRET_KEY ||= 'test'
process.env.S3_BUCKET ||= 'test'
// Force rate-limit ENABLED so signUpEmail exercises the rateLimit-model
// codepath that the previous adapter-dict gap broke.
process.env.DISABLE_AUTH_RATE_LIMIT = 'false'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { makeAuth, BA_MODELS } = await import('./better-auth-instance')
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'

let t: TestDb
let auth: ReturnType<typeof makeAuth>

beforeEach(async () => {
  t = await makeTestDb()
  // The factory expects PgDatabase<…>; PGLite's drizzle satisfies the
  // structural type at the methods Better Auth's adapter actually calls
  // (insert/update/delete/select). Cast is safe because BA never touches
  // a postgres-js-specific API path.
  auth = makeAuth(t.db as unknown as Parameters<typeof makeAuth>[0])
})

afterEach(async () => {
  await t.cleanup()
})

describe('Better Auth adapter wiring', () => {
  it('BA_MODELS is the exhaustive set of models Better Auth queries at runtime', () => {
    // If you add a Better Auth plugin or storage option that introduces a
    // new table, you MUST update BA_MODELS + this list. The runtime test
    // below catches the gap if you only update one; this gives a faster,
    // diff-visible signal at review time.
    expect(Object.keys(BA_MODELS).sort()).toEqual([
      'account',
      'invitation',
      'member',
      'organization',
      'rateLimit',
      'session',
      'user',
      'verification',
    ])
  })

  it('signUpEmail completes end-to-end against a real Postgres', async () => {
    // Full user-creation path. Touches user + account + session tables
    // and — because we set DISABLE_AUTH_RATE_LIMIT=false above — also
    // the rateLimit table via the rate-limit storage adapter. If ANY of
    // those models is missing from BA_MODELS the drizzleAdapter throws
    // "model <name> was not found in the schema object" before the row
    // ever reaches Postgres.
    const result = await auth.api.signUpEmail({
      body: {
        email: 'wire@test.example',
        password: 'correcthorsebatterystaple',
        name: 'Wire Test',
      },
    })
    expect(result?.user?.email).toBe('wire@test.example')
    expect(result?.user?.id).toBeTruthy()
  })

  it('the BA adapter can query every registered model', async () => {
    // Belt-and-suspenders: even if signUpEmail's code path skips a model,
    // this loop forces a query against every entry. The adapter's
    // `findMany` rejects on unknown models with the canonical error.
    //
    // `auth.$context` is a Promise (BA initialises lazily); await once,
    // then iterate. Empty `where` returns whatever is there — for fresh
    // PGLite that's `[]`, but the point is the query SHAPE, not the rows.
    const ctx = await auth.$context
    const adapter = ctx.adapter
    for (const model of Object.keys(BA_MODELS)) {
      await expect(
        adapter.findMany({ model, where: [] }),
      ).resolves.toBeDefined()
    }
  })
})
