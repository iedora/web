import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, like, ne, or } from 'drizzle-orm'
import * as schema from '@/shared/db/schema'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import { isValidSlugShape, slugify } from './use-cases/slugify'
import { nextAvailableSlug } from './use-cases/next-available'
import { rename } from './use-cases/rename'
import type { SlugRegistry } from './ports'

vi.mock('server-only', () => ({}))

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('slugify', () => {
  it.each([
    ['Sushi Akira', 'sushi-akira'],
    ['  Bom   Garfo  ', 'bom-garfo'],
    ['Cafe São Bento', 'cafe-sao-bento'],
    ['ALL CAPS LIKE!!!', 'all-caps-like'],
    ['já-existing-hyphens', 'ja-existing-hyphens'],
    ['multiple---dashes', 'multiple-dashes'],
    ['-leading-and-trailing-', 'leading-and-trailing'],
    ['', 'restaurant'],
    ['🍣🍣🍣', 'restaurant'],
    ['...!!!', 'restaurant'],
    ['012345', '012345'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps at 40 chars', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long)).toBe('a'.repeat(40))
  })
})

describe('isValidSlugShape', () => {
  it.each([
    ['ab', true],
    ['sushi-akira', true],
    ['restaurant-2', true],
    ['012345', true],
    ['a', false], // too short
    ['-foo', false], // leading dash
    ['foo-', false], // trailing dash
    ['UPPER', false], // uppercase
    ['has spaces', false],
    ['has_underscore', false], // underscores not allowed
    ['a'.repeat(41), false], // over 40 chars
  ])('%s → %s', (input, expected) => {
    expect(isValidSlugShape(input)).toBe(expected)
  })
})

// ── nextAvailableSlug (fake registry — no DB needed) ────────────────────────

function fakeRegistry(used: ReadonlyArray<string>): SlugRegistry {
  const set = new Set(used)
  return {
    async findMatching(base) {
      return [...set].filter(
        (s) => s === base || s.startsWith(`${base}-`),
      )
    },
    async rename(_id, slug) {
      if (set.has(slug)) return { ok: false, reason: 'taken' }
      set.add(slug)
      return { ok: true }
    },
  }
}

describe('nextAvailableSlug', () => {
  it('returns the base when nothing is taken', async () => {
    const reg = fakeRegistry([])
    expect(await nextAvailableSlug(reg, 'sushi-place')).toBe('sushi-place')
  })

  it('returns base-2 when base is taken', async () => {
    const reg = fakeRegistry(['sushi-place'])
    expect(await nextAvailableSlug(reg, 'sushi-place')).toBe('sushi-place-2')
  })

  it('finds the first gap in the suffix sequence', async () => {
    const reg = fakeRegistry([
      'sushi-place',
      'sushi-place-2',
      'sushi-place-3',
      'sushi-place-5',
    ])
    expect(await nextAvailableSlug(reg, 'sushi-place')).toBe('sushi-place-4')
  })

  it('does not collide with overlapping base prefixes', async () => {
    // `sushi-place-deluxe` is unrelated — must not be counted toward
    // the sushi-place sequence. The registry filter uses prefix match
    // BUT the use-case treats only `base` + `base-N` as collisions.
    const reg = fakeRegistry(['sushi-place-deluxe'])
    // Our fake returns `sushi-place-deluxe` because `s.startsWith('sushi-place-')`.
    // The use-case treats it as `sushi-place-deluxe` ∈ used set, but its
    // gap-walker only checks `base-2`, `base-3`… numeric suffixes, so
    // `sushi-place` (base) is still free.
    expect(await nextAvailableSlug(reg, 'sushi-place')).toBe('sushi-place')
  })

  it('blows up after 1000 collisions — defensive bound', async () => {
    const reg = fakeRegistry(
      Array.from({ length: 1001 }, (_, i) =>
        i === 0 ? 'busy' : `busy-${i + 1}`,
      ),
    )
    await expect(nextAvailableSlug(reg, 'busy')).rejects.toThrow(
      /1000 collisions/,
    )
  })
})

// ── rename use-case (fake registry) ─────────────────────────────────────────

describe('rename', () => {
  it('claims a valid + free slug', async () => {
    const reg = fakeRegistry([])
    const res = await rename(reg, { restaurantId: 'r-1', slug: 'sushi-akira' })
    expect(res).toEqual({ ok: true, slug: 'sushi-akira' })
  })

  it('rejects invalid shapes before touching the registry', async () => {
    const reg = fakeRegistry([])
    const spy = vi.spyOn(reg, 'rename')
    const res = await rename(reg, { restaurantId: 'r-1', slug: 'INVALID UPPER' })
    expect(res).toMatchObject({ ok: false, reason: 'invalid' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports `taken` when the registry says the slug is in use', async () => {
    const reg = fakeRegistry(['sushi-akira'])
    const res = await rename(reg, { restaurantId: 'r-2', slug: 'sushi-akira' })
    expect(res).toMatchObject({ ok: false, reason: 'taken' })
  })

  it('normalises whitespace + case before validation', async () => {
    const reg = fakeRegistry([])
    const res = await rename(reg, {
      restaurantId: 'r-1',
      slug: '  Sushi-Akira  ',
    })
    expect(res).toEqual({ ok: true, slug: 'sushi-akira' })
  })
})

// ── Integration — Drizzle adapter wired up against PGLite ───────────────────

let t: TestDb

beforeEach(async () => {
  t = await makeTestDb()
})

afterEach(async () => {
  await t.cleanup()
})

// Standalone fixture matching the production adapter shape, pointed at
// the PGLite db — same SQL as `adapters/drizzle.ts`. Replicated here
// rather than importing because the prod module is `'server-only'`.
function pgliteRegistry(testDb: TestDb): SlugRegistry {
  const { db } = testDb
  return {
    async findMatching(base) {
      const rows = await db
        .select({ slug: schema.restaurant.slug })
        .from(schema.restaurant)
        .where(
          or(
            eq(schema.restaurant.slug, base),
            like(schema.restaurant.slug, `${base}-%`),
          ),
        )
      return rows.map((r) => r.slug)
    },
    async rename(restaurantId, newSlug) {
      const conflict = await db
        .select({ id: schema.restaurant.id })
        .from(schema.restaurant)
        .where(
          and(
            eq(schema.restaurant.slug, newSlug),
            ne(schema.restaurant.id, restaurantId),
          ),
        )
        .limit(1)
      if (conflict.length > 0) return { ok: false, reason: 'taken' }
      try {
        await db
          .update(schema.restaurant)
          .set({ slug: newSlug })
          .where(eq(schema.restaurant.id, restaurantId))
      } catch (err) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? (err as { code: string }).code
            : ''
        if (code === '23505') return { ok: false, reason: 'taken' }
        throw err
      }
      return { ok: true }
    },
  }
}

async function seedRestaurant(testDb: TestDb, slug: string): Promise<string> {
  const [row] = await testDb.db
    .insert(schema.restaurant)
    .values({ organizationId: `org-${slug}`, name: slug, slug })
    .returning({ id: schema.restaurant.id })
  if (!row) throw new Error('seed failed')
  return row.id
}

describe('Drizzle integration (PGLite)', () => {
  it('nextAvailableSlug walks a real result set', async () => {
    const reg = pgliteRegistry(t)
    await seedRestaurant(t, 'sushi')
    await seedRestaurant(t, 'sushi-2')
    await seedRestaurant(t, 'sushi-4')
    expect(await nextAvailableSlug(reg, 'sushi')).toBe('sushi-3')
  })

  it('rename succeeds + the row reflects the new slug', async () => {
    const reg = pgliteRegistry(t)
    const id = await seedRestaurant(t, 'old')
    const res = await rename(reg, { restaurantId: id, slug: 'new' })
    expect(res).toEqual({ ok: true, slug: 'new' })

    const rows = await t.db
      .select({ slug: schema.restaurant.slug })
      .from(schema.restaurant)
      .where(eq(schema.restaurant.id, id))
    expect(rows[0]?.slug).toBe('new')
  })

  it('rename reports taken when another restaurant owns the slug', async () => {
    const reg = pgliteRegistry(t)
    const a = await seedRestaurant(t, 'alpha')
    await seedRestaurant(t, 'beta')
    const res = await rename(reg, { restaurantId: a, slug: 'beta' })
    expect(res).toMatchObject({ ok: false, reason: 'taken' })
  })

  it('rename to the same slug is a no-op success (the row itself owns it)', async () => {
    const reg = pgliteRegistry(t)
    const id = await seedRestaurant(t, 'mine')
    const res = await rename(reg, { restaurantId: id, slug: 'mine' })
    expect(res).toEqual({ ok: true, slug: 'mine' })
  })
})
