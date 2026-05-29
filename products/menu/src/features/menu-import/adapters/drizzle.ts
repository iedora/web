/**
 * Drizzle adapter for the menu-import slice.
 *
 * Implements `MenuImportPort` — positional inserts for menu, category, and item.
 * Tenant-scoped: restaurantId is stamped on every row (AGENTS.md hard rule #1).
 *
 * This adapter intentionally does NOT use a transaction — the use-case
 * persists the tree row by row. If a later item insert fails, the partial
 * menu is visible to the user and can be manually completed. A full
 * transaction would be better UX but the current `db` pool doesn't surface
 * a transaction handle to adapters not already inside one. Add a tx-aware
 * variant when the need arises.
 */
import 'server-only'
import { and, max, eq } from 'drizzle-orm'
import { db } from '../../../shared/db/client'
import { category, item, menu, restaurant } from '../../../shared/db/schema'
import type { MenuImportPort } from '../ports'

function only<T>(rows: T[], op: string): T {
  const row = rows[0]
  if (!row) throw new Error(`drizzle[menu-import]: ${op} returned no rows`)
  return row
}

function makeDrizzleMenuImport(): MenuImportPort {
  return {
    async createMenu(restaurantId, name) {
      const agg = only(
        await db
          .select({ next: max(menu.position) })
          .from(menu)
          .where(eq(menu.restaurantId, restaurantId)),
        'max(menu.position)',
      )

      const row = only(
        await db
          .insert(menu)
          .values({
            restaurantId,
            name,
            position: (agg.next ?? -1) + 1,
          })
          .returning({ id: menu.id }),
        'insert menu',
      )
      return row.id
    },

    async insertCategory(menuId, restaurantId, name, position) {
      const row = only(
        await db
          .insert(category)
          .values({ menuId, restaurantId, name, position })
          .returning({ id: category.id }),
        'insert category',
      )
      return row.id
    },

    async insertItem(categoryId, restaurantId, fields, position) {
      await db.insert(item).values({
        categoryId,
        restaurantId,
        name: fields.name,
        description: fields.description,
        priceCents: fields.priceCents,
        available: fields.available,
        position,
        // Persist variants when present; null otherwise so the column
        // doesn't carry empty arrays for the common single-price case.
        variants:
          fields.variants && fields.variants.length > 0
            ? fields.variants
            : null,
      })
    },

    // ── PATCH-mode helpers ──────────────────────────────────────────────
    // Used by `applyMenuPatch`. Each one is restaurant-scoped (defence
    // in depth) so a stray id from a different tenant could never be
    // touched.

    async findCategoryByMenuAndName(menuId: string, name: string) {
      const rows = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.menuId, menuId), eq(category.name, name)))
        .limit(1)
      return rows[0] ?? null
    },

    async renameCategory(categoryId: string, restaurantId: string, name: string) {
      await db
        .update(category)
        .set({ name })
        .where(
          and(eq(category.id, categoryId), eq(category.restaurantId, restaurantId)),
        )
    },

    async deleteCategory(categoryId: string, restaurantId: string) {
      await db
        .delete(category)
        .where(
          and(eq(category.id, categoryId), eq(category.restaurantId, restaurantId)),
        )
    },

    async updateItemFields(
      itemId: string,
      restaurantId: string,
      patch: {
        name?: string
        description?: string
        priceCents?: number
        variants?: Array<{ label: string; priceCents: number }>
      },
    ) {
      // Only spread the fields the AI included; untouched columns
      // (availability, image, i18n overrides) stay put. Passing
      // `variants: []` clears the jsonb column; omitting it leaves
      // the existing variants in place.
      const set: Record<string, unknown> = {}
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.priceCents !== undefined) set.priceCents = patch.priceCents
      if (patch.variants !== undefined) {
        set.variants = patch.variants.length > 0 ? patch.variants : null
      }
      if (Object.keys(set).length === 0) return
      await db
        .update(item)
        .set(set)
        .where(
          and(eq(item.id, itemId), eq(item.restaurantId, restaurantId)),
        )
    },

    async deleteItem(itemId: string, restaurantId: string) {
      await db
        .delete(item)
        .where(and(eq(item.id, itemId), eq(item.restaurantId, restaurantId)))
    },

    async findMaxItemPosition(categoryId: string) {
      const [row] = await db
        .select({ max: max(item.position) })
        .from(item)
        .where(eq(item.categoryId, categoryId))
      return Number(row?.max ?? -10)
    },

    async setRestaurantDefaultLanguage(restaurantId, language) {
      const rows = await db
        .update(restaurant)
        .set({ defaultLanguage: language })
        .where(eq(restaurant.id, restaurantId))
        .returning({ id: restaurant.id })
      return rows.length > 0
    },
  }
}

export const drizzleMenuImport = makeDrizzleMenuImport()
