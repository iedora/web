import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'

/**
 * Menu-builder seeds. Inserts skip the `position` recompute logic
 * (`reorder.ts`) — caller is responsible for sane initial positions if
 * the spec asserts ordering. Defaults: 0-based, sequential.
 */

export type SeededMenu = { menuId: string; restaurantId: string; name: string }
export type SeededCategory = { categoryId: string; menuId: string; name: string }
export type SeededItem = { itemId: string; categoryId: string; name: string; priceCents: number }

export async function seedMenu(
  restaurantId: string,
  opts: { name?: string; position?: number; active?: boolean } = {},
): Promise<SeededMenu> {
  const sql = testDb()
  const name = opts.name ?? 'Default Menu'
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."menu" (id, restaurant_id, name, position, active, updated_at)
    VALUES (gen_random_uuid()::text, ${restaurantId}, ${name}, ${opts.position ?? 0}, ${opts.active ?? true}, now())
    RETURNING id
  `
  return { menuId: row!.id, restaurantId, name }
}

export async function seedCategory(
  menuId: string,
  restaurantId: string,
  opts: { name?: string; position?: number } = {},
): Promise<SeededCategory> {
  const sql = testDb()
  const name = opts.name ?? 'Default Category'
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."category" (id, menu_id, restaurant_id, name, position, updated_at)
    VALUES (gen_random_uuid()::text, ${menuId}, ${restaurantId}, ${name}, ${opts.position ?? 0}, now())
    RETURNING id
  `
  return { categoryId: row!.id, menuId, name }
}

export async function seedItem(
  categoryId: string,
  restaurantId: string,
  opts: { name?: string; priceCents?: number; currency?: string; position?: number; available?: boolean } = {},
): Promise<SeededItem> {
  const sql = testDb()
  const name = opts.name ?? 'Default Item'
  const priceCents = opts.priceCents ?? 1000
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."item" (
      id, category_id, restaurant_id, name, price_cents, currency,
      position, available, updated_at
    )
    VALUES (
      gen_random_uuid()::text, ${categoryId}, ${restaurantId}, ${name},
      ${priceCents}, ${opts.currency ?? 'EUR'}, ${opts.position ?? 0},
      ${opts.available ?? true}, now()
    )
    RETURNING id
  `
  return { itemId: row!.id, categoryId, name, priceCents }
}
