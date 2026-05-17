import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, desc, sql } from 'drizzle-orm'
import { symmetricDecrypt } from 'better-auth/crypto'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import { jwks } from '@/shared/db/schema'
import {
  JWKS_ROTATION_LOCK_KEY,
  getLatestJwksKeyInfo,
  rotateJwks,
} from '../use-cases/rotate-jwks'

/**
 * JWKS rotation tests — exercise the use-case end-to-end against PGLite
 * (real Drizzle, real Postgres semantics including advisory locks).
 *
 * The use-case writes to the `jwks` table that Better Auth reads from at
 * sign time; we don't spin up Better Auth here. We verify:
 *   - the row shape (encrypted privateKey, public JSON, createdAt set);
 *   - the recency guard (no-op when last key is fresh);
 *   - `force: true` bypasses recency;
 *   - 10 parallel calls produce exactly one insert (lock contention);
 *   - rotation never deletes the old key (retention for token validation).
 */

const FAKE_SECRET = 'x'.repeat(48)

let tdb: TestDb

beforeEach(async () => {
  tdb = await makeTestDb()
})

afterEach(async () => {
  await tdb.cleanup()
})

describe('rotateJwks — first call', () => {
  it('inserts a row on an empty jwks table', async () => {
    const res = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })

    expect(res.ok).toBe(true)
    if (res.ok && res.rotated) {
      expect(res.newKeyId).toMatch(/^[0-9a-f-]{36}$/)
    } else {
      throw new Error('expected ok+rotated')
    }

    const rows = await tdb.db.select().from(jwks)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(res.newKeyId)
    expect(rows[0]!.createdAt).toBeInstanceOf(Date)
    // expiresAt is NULL so Better Auth retains the row indefinitely.
    expect(rows[0]!.expiresAt).toBeNull()
  })

  it('stores the private key encrypted (round-trips through symmetricDecrypt)', async () => {
    const res = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(res.ok).toBe(true)

    const [row] = await tdb.db.select().from(jwks)
    // privateKey is JSON.stringify(envelope) on disk; symmetricDecrypt
    // expects JSON.parse(...) to be passed back to it.
    const envelope = JSON.parse(row!.privateKey)
    const decrypted = await symmetricDecrypt({
      key: FAKE_SECRET,
      data: envelope,
    })
    // Must parse as a JWK with the expected shape (kty=OKP or kty=RSA etc).
    const jwk = JSON.parse(decrypted)
    expect(typeof jwk.kty).toBe('string')
    expect(jwk.kty.length).toBeGreaterThan(0)

    // publicKey is the un-encrypted public JWK as JSON — readable directly.
    const pub = JSON.parse(row!.publicKey)
    expect(typeof pub.kty).toBe('string')
  })
})

describe('rotateJwks — recency guard', () => {
  it('returns rotated=false when last key is within the interval', async () => {
    const first = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(first.ok).toBe(true)
    if (!first.ok || !first.rotated) throw new Error('first rotate failed')

    // Second call immediately — should be a no-op.
    const second = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(second.ok).toBe(true)
    if (second.ok && !second.rotated) {
      expect(second.reason).toBe('recent')
      expect(second.lastRotatedAt).toBeInstanceOf(Date)
    } else {
      throw new Error('expected ok+not-rotated')
    }

    // Only one row in the table.
    const rows = await tdb.db.select().from(jwks)
    expect(rows).toHaveLength(1)
  })

  it('rotates again when minIntervalDays is satisfied', async () => {
    const first = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(first.ok).toBe(true)

    // Backdate the first row by 100 days so the recency guard lets the
    // second call through.
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    await tdb.db.update(jwks).set({ createdAt: oldDate })

    const second = await rotateJwks(
      { minIntervalDays: 90 },
      { database: tdb.db, secret: FAKE_SECRET },
    )
    expect(second.ok).toBe(true)
    if (second.ok && second.rotated) {
      expect(second.newKeyId).toBeDefined()
    } else {
      throw new Error('expected ok+rotated')
    }

    const rows = await tdb.db.select().from(jwks)
    expect(rows).toHaveLength(2)
  })

  it('force=true always rotates regardless of recency', async () => {
    const first = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(first.ok).toBe(true)

    const second = await rotateJwks(
      { force: true },
      { database: tdb.db, secret: FAKE_SECRET },
    )
    expect(second.ok).toBe(true)
    if (!second.ok || !second.rotated) {
      throw new Error('expected ok+rotated under force')
    }

    const rows = await tdb.db
      .select()
      .from(jwks)
      .orderBy(asc(jwks.createdAt))
    expect(rows).toHaveLength(2)
    // OLD key still present — retention is the whole point of the design.
    if (first.ok && first.rotated) {
      const ids = rows.map((r) => r.id).sort()
      expect(ids).toContain(first.newKeyId)
      expect(ids).toContain(second.newKeyId)
    }
  })
})

describe('rotateJwks — retention', () => {
  it('rotated row coexists with the old row', async () => {
    const first = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(first.ok).toBe(true)
    if (!first.ok || !first.rotated) throw new Error('expected initial rotation')

    const second = await rotateJwks(
      { force: true },
      { database: tdb.db, secret: FAKE_SECRET },
    )
    expect(second.ok).toBe(true)
    if (!second.ok || !second.rotated) throw new Error('expected forced rotation')

    const rows = await tdb.db
      .select({ id: jwks.id })
      .from(jwks)
    expect(rows).toHaveLength(2)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(first.newKeyId)
    expect(ids).toContain(second.newKeyId)

    // Newest by createdAt is what Better Auth will sign with.
    const newest = await tdb.db
      .select({ id: jwks.id })
      .from(jwks)
      .orderBy(desc(jwks.createdAt))
      .limit(1)
    expect(newest[0]!.id).toBe(second.newKeyId)
  })
})

describe('rotateJwks — concurrency', () => {
  it('10 parallel calls insert exactly one row (lock contention)', async () => {
    const calls = Array.from({ length: 10 }, () =>
      rotateJwks(undefined, { database: tdb.db, secret: FAKE_SECRET }),
    )
    const results = await Promise.allSettled(calls)
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected).toHaveLength(0)

    const rotated = results.filter(
      (r) => r.status === 'fulfilled' && r.value.ok && r.value.rotated,
    )
    // Only ONE call should have actually inserted — the rest see a recent
    // row (created moments earlier under the lock) and short-circuit.
    expect(rotated).toHaveLength(1)

    const rows = await tdb.db.select().from(jwks)
    expect(rows).toHaveLength(1)
  })

  it('advisory lock is released after the call', async () => {
    await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    // No advisory locks dangling for our key after the txn commits.
    const locks = await tdb.db.execute(
      sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsLike = (locks as any).rows ?? locks
    const n = Array.isArray(rowsLike) ? Number(rowsLike[0]?.n ?? 0) : 0
    expect(n).toBe(0)
  })
})

describe('getLatestJwksKeyInfo', () => {
  it('returns null when no keys exist', async () => {
    const info = await getLatestJwksKeyInfo({ database: tdb.db })
    expect(info).toBeNull()
  })

  it('returns the newest key by createdAt', async () => {
    const a = await rotateJwks(undefined, {
      database: tdb.db,
      secret: FAKE_SECRET,
    })
    expect(a.ok).toBe(true)
    const b = await rotateJwks(
      { force: true },
      { database: tdb.db, secret: FAKE_SECRET },
    )
    expect(b.ok).toBe(true)
    if (!b.ok || !b.rotated) throw new Error('expected rotation')

    const info = await getLatestJwksKeyInfo({ database: tdb.db })
    expect(info).not.toBeNull()
    expect(info!.id).toBe(b.newKeyId)
  })
})

describe('JWKS_ROTATION_LOCK_KEY', () => {
  it('matches the CRC32 of "jwks_rotation"', () => {
    // Stability check — if someone renames the lock key string without
    // updating the constant, this test fails.
    expect(JWKS_ROTATION_LOCK_KEY).toBe(3828642905)
  })
})
