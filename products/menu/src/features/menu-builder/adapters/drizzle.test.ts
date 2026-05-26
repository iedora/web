/**
 * Real-Postgres tests for the menu-builder adapter — the parts where the SQL
 * matters (batched reorder via UPDATE FROM VALUES). PGLite gives us actual
 * Postgres semantics for the multi-row update pattern.
 *
 * The adapter module binds a prod `drizzleMenuWrite = makeDrizzleMenuWrite(db)`
 * singleton at import time, which would normally trip the env validation in
 * `@/shared/env`. We stub the required env vars before importing — the
 * postgres-js client they configure is lazy (no real connect) and we test
 * against a separate PGLite instance via the factory.
 */
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test'
process.env.CORE_DATABASE_URL ||= 'postgres://test:test@localhost/core_test'
process.env.IEDORA_CORE_SECRET ||= 'a'.repeat(48)
process.env.IEDORA_CORE_BASE_URL ||= 'http://localhost:3000'
process.env.NEXT_PUBLIC_CORE_URL ||= 'http://localhost:3000/core'
process.env.MENU_PUBLIC_URL ||= 'http://localhost:3000'
process.env.S3_ENDPOINT ||= 'http://localhost:4566'
process.env.S3_REGION ||= 'us-east-1'
process.env.S3_ACCESS_KEY ||= 'test'
process.env.S3_SECRET_KEY ||= 'test'
process.env.S3_BUCKET ||= 'test'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

const { makeDrizzleMenuWrite } = await import('./drizzle')
import type { MenuWritePort } from '../ports'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import { category, item, menu, restaurant } from '@/shared/db/schema'

let t: TestDb
let writer: MenuWritePort

beforeEach(async () => {
  t = await makeTestDb()
  writer = makeDrizzleMenuWrite(t.db)
})

afterEach(async () => {
  await t.cleanup()
})

async function seedMenu(): Promise<{ menuId: string; restaurantId: string }> {
  // `organizationId` is a plain UUID handed back by Genkan in real life —
  // no FK to anything menu-local, so we can seed an arbitrary string.
  const orgId = 'o-1'
  const restaurantId = 'r-1'
  const menuId = 'm-1'
  await t.db.insert(restaurant).values({
    id: restaurantId,
    organizationId: orgId,
    name: 'Place',
    slug: 'place',
  })
  await t.db.insert(menu).values({
    id: menuId,
    restaurantId,
    name: 'Main',
    position: 0,
  })
  return { menuId, restaurantId }
}

describe('drizzleMenuWrite — batched reorder', () => {
  it('reorderCategories: renumbers positions 0..n-1 atomically', async () => {
    const { menuId, restaurantId } = await seedMenu()
    const ids = ['c-a', 'c-b', 'c-c', 'c-d', 'c-e']
    await t.db.insert(category).values(
      ids.map((id, i) => ({
        id,
        menuId,
        restaurantId,
        name: id,
        position: i,
      })),
    )

    // Reverse the order — every position must change.
    const reversed = [...ids].reverse()
    await writer.reorderCategories(menuId, restaurantId, reversed)

    const rows = await t.db
      .select({ id: category.id, position: category.position })
      .from(category)
      .where(eq(category.menuId, menuId))
      .orderBy(asc(category.position))

    expect(rows.map((r) => r.id)).toEqual(reversed)
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4])
  })

  it('reorderItems: renumbers positions 0..n-1 atomically', async () => {
    const { menuId, restaurantId } = await seedMenu()
    const catId = 'cat-x'
    await t.db.insert(category).values({
      id: catId,
      menuId,
      restaurantId,
      name: 'cat',
      position: 0,
    })
    const ids = ['i-a', 'i-b', 'i-c']
    await t.db.insert(item).values(
      ids.map((id, i) => ({
        id,
        categoryId: catId,
        restaurantId,
        name: id,
        priceCents: 100,
        position: i,
      })),
    )

    await writer.reorderItems(catId, restaurantId, ['i-c', 'i-a', 'i-b'])

    const rows = await t.db
      .select({ id: item.id, position: item.position })
      .from(item)
      .where(eq(item.categoryId, catId))
      .orderBy(asc(item.position))

    expect(rows.map((r) => r.id)).toEqual(['i-c', 'i-a', 'i-b'])
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2])
  })

  it('reorderCategories: does not touch rows in other menus', async () => {
    const { menuId, restaurantId } = await seedMenu()
    // Second menu in the same restaurant. Reorder of menu-1 must not
    // renumber menu-2's category (defence-in-depth WHERE).
    const otherMenuId = 'm-2'
    await t.db.insert(menu).values({
      id: otherMenuId,
      restaurantId,
      name: 'Other',
      position: 1,
    })
    await t.db.insert(category).values([
      { id: 'c-1', menuId, restaurantId, name: 'a', position: 0 },
      { id: 'c-2', menuId, restaurantId, name: 'b', position: 1 },
      { id: 'c-3', menuId: otherMenuId, restaurantId, name: 'other', position: 99 },
    ])

    await writer.reorderCategories(menuId, restaurantId, ['c-2', 'c-1'])

    const [other] = await t.db
      .select({ position: category.position })
      .from(category)
      .where(eq(category.id, 'c-3'))
    expect(other?.position).toBe(99) // untouched
  })

  it('reorder is a no-op when given an empty list', async () => {
    const { menuId, restaurantId } = await seedMenu()
    await expect(
      writer.reorderCategories(menuId, restaurantId, []),
    ).resolves.toBeUndefined()
  })
})

describe('drizzleMenuWrite.seedSampleMenu — variants persistence', () => {
  it('writes variants on items that have them, leaves null otherwise', async () => {
    const orgId = 'o-seed'
    const restaurantId = 'r-seed'
    await t.db.insert(restaurant).values({
      id: restaurantId,
      organizationId: orgId,
      name: 'Place',
      slug: 'place-seed',
    })

    await writer.seedSampleMenu(restaurantId, {
      menuName: { default: 'Sample', i18n: null },
      categories: [
        {
          name: { default: 'Mains', i18n: null },
          items: [
            // No variants — should land as NULL.
            {
              name: { default: 'Carbonara', i18n: null },
              description: { default: 'Guanciale, pecorino', i18n: null },
              priceCents: 1400,
              currency: 'EUR',
            },
            // Variants — should round-trip as a jsonb array.
            {
              name: { default: 'Steak frites', i18n: null },
              description: { default: 'House cut', i18n: null },
              priceCents: 1900,
              currency: 'EUR',
              variants: [{ label: 'Meia dose', priceCents: 1100 }],
            },
          ],
        },
      ],
    })

    const rows = await t.db
      .select({
        name: item.name,
        priceCents: item.priceCents,
        variants: item.variants,
      })
      .from(item)
      .where(eq(item.restaurantId, restaurantId))
      .orderBy(asc(item.position))

    expect(rows).toHaveLength(2)
    expect(rows[0]?.name).toBe('Carbonara')
    expect(rows[0]?.variants).toBeNull()

    expect(rows[1]?.name).toBe('Steak frites')
    expect(rows[1]?.variants).toEqual([
      { label: 'Meia dose', priceCents: 1100 },
    ])
  })

  it('writes null when the variants array is present but empty', async () => {
    const orgId = 'o-empty'
    const restaurantId = 'r-empty'
    await t.db.insert(restaurant).values({
      id: restaurantId,
      organizationId: orgId,
      name: 'Place',
      slug: 'place-empty',
    })

    await writer.seedSampleMenu(restaurantId, {
      menuName: { default: 'Sample', i18n: null },
      categories: [
        {
          name: { default: 'Snacks', i18n: null },
          items: [
            {
              name: { default: 'Olives', i18n: null },
              description: { default: 'house brine', i18n: null },
              priceCents: 300,
              currency: 'EUR',
              variants: [],
            },
          ],
        },
      ],
    })

    const [row] = await t.db
      .select({ variants: item.variants })
      .from(item)
      .where(eq(item.restaurantId, restaurantId))
    expect(row?.variants).toBeNull()
  })
})
