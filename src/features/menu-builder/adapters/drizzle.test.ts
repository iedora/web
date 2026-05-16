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
process.env.BETTER_AUTH_SECRET ||= 'x'.repeat(32)
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'
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
import {
  category,
  item,
  menu,
  organization,
  restaurant,
} from '@/shared/db/schema'

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
  const orgId = 'o-1'
  const restaurantId = 'r-1'
  const menuId = 'm-1'
  await t.db.insert(organization).values({
    id: orgId,
    name: 'Org',
    slug: 'org',
    plan: 'free',
    createdAt: new Date(),
  })
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
