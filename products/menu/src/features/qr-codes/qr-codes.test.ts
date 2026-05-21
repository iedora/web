import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'
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
        .orderBy(desc(schema.qrCode.createdAt))
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
