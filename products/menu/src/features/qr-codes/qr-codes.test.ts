import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, desc, eq } from 'drizzle-orm'
import * as schema from '@/shared/db/schema'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import type { QrCodesGateway } from './ports'
import { createCode } from './use-cases/create-code'
import { bulkGenerate } from './use-cases/bulk-generate'
import { bindCode } from './use-cases/bind'
import { unbindCode } from './use-cases/unbind'
import { deleteCode } from './use-cases/delete-code'
import { resolveCode } from './use-cases/resolve'
import { listCodes } from './use-cases/list-codes'
import { updateLabel } from './use-cases/update-label'

vi.mock('server-only', () => ({}))

let t: TestDb

beforeEach(async () => {
  t = await makeTestDb()
})

afterEach(async () => {
  await t.cleanup()
})

/**
 * PGLite-backed gateway — same SQL shape as the production adapter but
 * pointed at the test db. Keeps the test exercising real Drizzle queries
 * (and therefore real Postgres semantics) without standing up a network
 * service.
 */
function makeGateway(testDb: TestDb): QrCodesGateway {
  const { db } = testDb
  return {
    async insertCode({ code, restaurantId, boundAt, label }) {
      const inserted = await db
        .insert(schema.qrCode)
        .values({ code, restaurantId, boundAt, label })
        .onConflictDoNothing({ target: schema.qrCode.code })
        .returning({ code: schema.qrCode.code })
      return { duplicate: inserted.length === 0 }
    },
    async insertManyUnbound(codes) {
      if (codes.length === 0) return { insertedCodes: [] }
      const inserted = await db
        .insert(schema.qrCode)
        .values(codes.map((c) => ({ code: c })))
        .onConflictDoNothing({ target: schema.qrCode.code })
        .returning({ code: schema.qrCode.code })
      return { insertedCodes: inserted.map((r) => r.code) }
    },
    async bind({ code, restaurantId }) {
      const rows = await db
        .update(schema.qrCode)
        .set({ restaurantId, boundAt: new Date() })
        .where(eq(schema.qrCode.code, code))
        .returning({ code: schema.qrCode.code })
      return { found: rows.length > 0 }
    },
    async unbind(code) {
      const rows = await db
        .update(schema.qrCode)
        .set({ restaurantId: null, boundAt: null })
        .where(eq(schema.qrCode.code, code))
        .returning({ code: schema.qrCode.code })
      return { found: rows.length > 0 }
    },
    async deleteCode(code) {
      const rows = await db
        .delete(schema.qrCode)
        .where(eq(schema.qrCode.code, code))
        .returning({ code: schema.qrCode.code })
      return { found: rows.length > 0 }
    },
    async updateLabel({ code, label }) {
      const rows = await db
        .update(schema.qrCode)
        .set({ label })
        .where(eq(schema.qrCode.code, code))
        .returning({ code: schema.qrCode.code })
      return { found: rows.length > 0 }
    },
    async list() {
      const rows = await db
        .select({
          code: schema.qrCode.code,
          restaurantId: schema.qrCode.restaurantId,
          label: schema.qrCode.label,
          createdAt: schema.qrCode.createdAt,
          boundAt: schema.qrCode.boundAt,
          restaurantName: schema.restaurant.name,
          restaurantSlug: schema.restaurant.slug,
        })
        .from(schema.qrCode)
        .leftJoin(
          schema.restaurant,
          eq(schema.qrCode.restaurantId, schema.restaurant.id),
        )
        .orderBy(desc(schema.qrCode.createdAt), asc(schema.qrCode.code))
      return rows.map((r) => ({
        code: r.code,
        restaurantId: r.restaurantId,
        label: r.label,
        createdAt: r.createdAt,
        boundAt: r.boundAt,
        restaurant:
          r.restaurantId && r.restaurantName && r.restaurantSlug
            ? {
                id: r.restaurantId,
                name: r.restaurantName,
                slug: r.restaurantSlug,
              }
            : null,
      }))
    },
    async listForRestaurant(restaurantId) {
      const rows = await db
        .select({
          code: schema.qrCode.code,
          restaurantId: schema.qrCode.restaurantId,
          label: schema.qrCode.label,
          createdAt: schema.qrCode.createdAt,
          boundAt: schema.qrCode.boundAt,
        })
        .from(schema.qrCode)
        .where(eq(schema.qrCode.restaurantId, restaurantId))
        .orderBy(desc(schema.qrCode.boundAt))
      return rows
    },
    async resolveBound(code) {
      const rows = await db
        .select({ code: schema.qrCode.code, slug: schema.restaurant.slug })
        .from(schema.qrCode)
        .innerJoin(
          schema.restaurant,
          eq(schema.qrCode.restaurantId, schema.restaurant.id),
        )
        .where(eq(schema.qrCode.code, code))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return { code: row.code, restaurantSlug: row.slug }
    },
    async restaurantExists(restaurantId) {
      const rows = await db
        .select({ id: schema.restaurant.id })
        .from(schema.restaurant)
        .where(eq(schema.restaurant.id, restaurantId))
        .limit(1)
      return rows.length > 0
    },
  }
}

async function seedRestaurant(t: TestDb, id = 'r1', slug = 'sushi') {
  await t.db.insert(schema.restaurant).values({
    id,
    organizationId: 'o1',
    name: slug,
    slug,
  })
}

describe('createCode', () => {
  it('accepts an admin-supplied custom code, normalised to lower-case', async () => {
    const gw = makeGateway(t)
    const res = await createCode(gw, { code: 'AbCd_99' })
    expect(res).toEqual({ ok: true, code: 'abcd_99' })
  })

  it('generates a code when none supplied (8-char default)', async () => {
    const gw = makeGateway(t)
    const res = await createCode(gw, {})
    if (!res.ok) throw new Error('expected ok')
    expect(res.code).toMatch(/^[a-z0-9_-]{8}$/)
  })

  it('rejects invalid shape', async () => {
    const gw = makeGateway(t)
    const res = await createCode(gw, { code: 'has spaces!' })
    expect(res).toEqual({ ok: false, error: 'invalid_shape' })
  })

  it('refuses to bind on create when the restaurant does not exist', async () => {
    const gw = makeGateway(t)
    const res = await createCode(gw, { code: 'abc', restaurantId: 'nope' })
    expect(res).toEqual({ ok: false, error: 'restaurant_not_found' })
  })

  it('binds on create + sets boundAt when restaurantId is supplied', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    const res = await createCode(gw, { code: 'abc', restaurantId: 'r1' })
    expect(res.ok).toBe(true)
    const resolved = await resolveCode(gw, 'abc')
    expect(resolved).toEqual({ code: 'abc', restaurantSlug: 'sushi' })
  })

  it('reports duplicate on collision with an existing PK', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'same' })
    const dup = await createCode(gw, { code: 'same' })
    expect(dup).toEqual({ ok: false, error: 'duplicate' })
  })
})

describe('bulkGenerate', () => {
  it('mints N unique unbound codes', async () => {
    const gw = makeGateway(t)
    const res = await bulkGenerate(gw, { count: 50 })
    if (!res.ok) throw new Error('expected ok')
    expect(res.codes.length).toBe(50)
    expect(new Set(res.codes).size).toBe(50)
  })

  it('rejects counts outside [1,500]', async () => {
    const gw = makeGateway(t)
    expect((await bulkGenerate(gw, { count: 0 })).ok).toBe(false)
    expect((await bulkGenerate(gw, { count: 501 })).ok).toBe(false)
    expect((await bulkGenerate(gw, { count: 2.5 })).ok).toBe(false)
  })

  it('list orders by createdAt DESC with a stable `code` tiebreaker so re-fetches preserve the order', async () => {
    const gw = makeGateway(t)
    // Single bulk insert ⇒ every row shares the same createdAt. Without
    // a tiebreaker, Postgres may return them in any order.
    const res = await bulkGenerate(gw, { count: 20 })
    if (!res.ok) throw new Error('expected ok')

    const a = (await listCodes(gw)).map((r) => r.code)
    const b = (await listCodes(gw)).map((r) => r.code)
    expect(a).toEqual(b)

    // Within a single createdAt group, codes come out in ASC order.
    const sortedAsc = [...a].sort()
    expect(a).toEqual(sortedAsc)
  })

  it('list keeps newer single-inserts at the top, older bulk-inserts beneath', async () => {
    const gw = makeGateway(t)
    const bulk = await bulkGenerate(gw, { count: 3 })
    if (!bulk.ok) throw new Error('expected ok')
    // PGLite + the test schema use millisecond-resolution timestamps;
    // wait a tick so the next insert wins on createdAt.
    await new Promise((r) => setTimeout(r, 5))
    await createCode(gw, { code: 'zzz-newest' })

    const rows = await listCodes(gw)
    expect(rows[0]?.code).toBe('zzz-newest')
    // The 3 older codes still come back in stable ASC order behind it.
    const tail = rows.slice(1).map((r) => r.code)
    expect(tail).toEqual([...tail].sort())
  })

  it('bind / unbind / updateLabel / delete do not shuffle the list order', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    const bulk = await bulkGenerate(gw, { count: 5 })
    if (!bulk.ok) throw new Error('expected ok')

    const before = (await listCodes(gw)).map((r) => r.code)

    // Touch every mutation surface that operates on existing rows.
    await bindCode(gw, { code: bulk.codes[0]!, restaurantId: 'r1' })
    await updateLabel(gw, { code: bulk.codes[1]!, label: 'box A' })
    await unbindCode(gw, bulk.codes[0]!)
    await deleteCode(gw, bulk.codes[4]!)

    const after = (await listCodes(gw)).map((r) => r.code)
    // Surviving codes appear in the same relative order — none of these
    // mutations touch `createdAt`, and `code` is a stable tiebreaker.
    expect(after).toEqual(before.filter((c) => c !== bulk.codes[4]))
  })
})

describe('bind / unbind / resolve', () => {
  beforeEach(async () => {
    await seedRestaurant(t)
  })

  it('binds an existing unbound code to a restaurant', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'sticker1' })
    const res = await bindCode(gw, { code: 'sticker1', restaurantId: 'r1' })
    expect(res.ok).toBe(true)

    const resolved = await resolveCode(gw, 'sticker1')
    expect(resolved).toEqual({ code: 'sticker1', restaurantSlug: 'sushi' })
  })

  it('unbinds an existing bound code', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'sticker1', restaurantId: 'r1' })
    expect(await unbindCode(gw, 'sticker1')).toEqual({ ok: true })
    expect(await resolveCode(gw, 'sticker1')).toBeNull()
  })

  it('errors when binding a code that does not exist', async () => {
    const gw = makeGateway(t)
    const res = await bindCode(gw, { code: 'ghost', restaurantId: 'r1' })
    expect(res).toEqual({ ok: false, error: 'code_not_found' })
  })

  it('errors when binding to a restaurant that does not exist', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'sticker1' })
    const res = await bindCode(gw, { code: 'sticker1', restaurantId: 'ghost' })
    expect(res).toEqual({ ok: false, error: 'restaurant_not_found' })
  })

  it('public resolver returns null for unknown / unbound / malformed codes', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'unbound' })
    expect(await resolveCode(gw, 'never-existed')).toBeNull()
    expect(await resolveCode(gw, 'unbound')).toBeNull()
    expect(await resolveCode(gw, 'has spaces!')).toBeNull()
  })
})

describe('deleteCode + list', () => {
  it('deletes an existing code', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'gone' })
    expect(await deleteCode(gw, 'gone')).toEqual({ ok: true })
    expect((await listCodes(gw)).length).toBe(0)
  })

  it('errors deleting a code that does not exist', async () => {
    const gw = makeGateway(t)
    expect(await deleteCode(gw, 'never')).toEqual({
      ok: false,
      error: 'code_not_found',
    })
  })

  it('list joins bound rows with restaurant + leaves unbound restaurant null', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    await createCode(gw, { code: 'bound', restaurantId: 'r1' })
    await createCode(gw, { code: 'free' })
    const rows = await listCodes(gw)
    const map = new Map(rows.map((r) => [r.code, r]))
    expect(map.get('bound')?.restaurant?.slug).toBe('sushi')
    expect(map.get('free')?.restaurant).toBeNull()
  })
})

describe('updateLabel', () => {
  it('trims + sets the label', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'lbl1' })
    expect(await updateLabel(gw, { code: 'lbl1', label: '  Box A · May  ' })).toEqual({
      ok: true,
    })
    const rows = await listCodes(gw)
    expect(rows.find((r) => r.code === 'lbl1')?.label).toBe('Box A · May')
  })

  it('an empty string clears the label (sets it to null)', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'lbl2', label: 'starts-with' })
    expect(await updateLabel(gw, { code: 'lbl2', label: '' })).toEqual({ ok: true })
    const rows = await listCodes(gw)
    expect(rows.find((r) => r.code === 'lbl2')?.label).toBeNull()
  })

  it('rejects a label over 200 chars', async () => {
    const gw = makeGateway(t)
    await createCode(gw, { code: 'lbl3' })
    expect(await updateLabel(gw, { code: 'lbl3', label: 'x'.repeat(201) })).toEqual({
      ok: false,
      error: 'invalid_label',
    })
  })

  it('errors when the code does not exist', async () => {
    const gw = makeGateway(t)
    expect(await updateLabel(gw, { code: 'nope', label: 'x' })).toEqual({
      ok: false,
      error: 'code_not_found',
    })
  })
})

describe('listForRestaurant', () => {
  it('returns an empty list when no codes are bound', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    expect(await gw.listForRestaurant('r1')).toEqual([])
  })

  it('returns only the codes bound to the requested restaurant', async () => {
    await seedRestaurant(t, 'r1', 'sushi')
    await seedRestaurant(t, 'r2', 'bistro')
    const gw = makeGateway(t)
    await createCode(gw, { code: 'sushi-1', restaurantId: 'r1' })
    await createCode(gw, { code: 'sushi-2', restaurantId: 'r1' })
    await createCode(gw, { code: 'bistro-1', restaurantId: 'r2' })
    await createCode(gw, { code: 'free' }) // unbound — must not appear

    const rows = await gw.listForRestaurant('r1')
    const codes = new Set(rows.map((r) => r.code))
    expect(codes).toEqual(new Set(['sushi-1', 'sushi-2']))
  })

  it('orders by boundAt desc (most recently bound first)', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    // Insert in chronological order; rely on real timestamps from boundAt.
    await createCode(gw, { code: 'first', restaurantId: 'r1' })
    await new Promise((r) => setTimeout(r, 5))
    await createCode(gw, { code: 'second', restaurantId: 'r1' })
    await new Promise((r) => setTimeout(r, 5))
    await createCode(gw, { code: 'third', restaurantId: 'r1' })

    const rows = await gw.listForRestaurant('r1')
    expect(rows.map((r) => r.code)).toEqual(['third', 'second', 'first'])
  })
})

describe('FK behaviour on restaurant delete', () => {
  it('unbinds the qr_code row when the restaurant is deleted (ON DELETE SET NULL)', async () => {
    await seedRestaurant(t)
    const gw = makeGateway(t)
    await createCode(gw, { code: 'sticker1', restaurantId: 'r1' })
    await t.db.delete(schema.restaurant).where(eq(schema.restaurant.id, 'r1'))
    const rows = await listCodes(gw)
    const row = rows.find((r) => r.code === 'sticker1')
    expect(row?.restaurantId).toBeNull()
    expect(row?.restaurant).toBeNull()
  })
})
