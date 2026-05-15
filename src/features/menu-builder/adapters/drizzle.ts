import 'server-only'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { category, item, menu, restaurant } from '@/shared/db/schema'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import type { MenuReadPort, MenuWritePort } from '../ports'

/**
 * Production MenuWritePort. Wraps the Drizzle mutations that previously
 * lived inline in `app/dashboard/r/[slug]/m/[menuId]/actions.ts`. Single-
 * transaction reorder + position renumber stay in the adapter — they are
 * I/O-shaped, not business logic (AGENTS.md hard rule #7).
 */
export const drizzleMenuWrite: MenuWritePort = {
  async findMenuInRestaurant(menuId, restaurantId) {
    const rows = await db
      .select({ id: menu.id })
      .from(menu)
      .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
      .limit(1)
    return rows[0] ?? null
  },

  async findCategoryInRestaurant(categoryId, restaurantId) {
    const rows = await db
      .select({ id: category.id, menuId: category.menuId })
      .from(category)
      .where(
        and(eq(category.id, categoryId), eq(category.restaurantId, restaurantId)),
      )
      .limit(1)
    return rows[0] ?? null
  },

  async findItemInRestaurant(itemId, restaurantId) {
    const rows = await db
      .select({ id: item.id, categoryId: item.categoryId })
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.restaurantId, restaurantId)))
      .limit(1)
    return rows[0] ?? null
  },

  async insertCategoryAtEnd(menuId, restaurantId, name) {
    const [{ next }] = await db
      .select({ next: max(category.position) })
      .from(category)
      .where(eq(category.menuId, menuId))

    const [row] = await db
      .insert(category)
      .values({
        menuId,
        restaurantId,
        name,
        position: (next ?? -1) + 1,
      })
      .returning({ id: category.id })
    return row.id
  },

  async updateCategoryName(categoryId, name) {
    await db.update(category).set({ name }).where(eq(category.id, categoryId))
  },

  async updateCategoryTranslations(categoryId, fields) {
    await db
      .update(category)
      .set({
        name: fields.name,
        description: fields.description,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(category.id, categoryId))
  },

  async deleteCategory(categoryId) {
    await db.delete(category).where(eq(category.id, categoryId))
  },

  async reorderCategories(menuId, restaurantId, orderedIds) {
    // Single transaction: renumber positions 0..n-1 over the supplied order.
    // Filtering by menuId AND restaurantId is defence-in-depth — the action
    // shell already verified ownership, but we keep the WHERE tight so a
    // stale client id can't slip across tenants. AGENTS.md hard rule #7.
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(category)
          .set({ position: i })
          .where(
            and(
              eq(category.id, orderedIds[i]),
              eq(category.menuId, menuId),
              eq(category.restaurantId, restaurantId),
            ),
          )
      }
    })
  },

  async updateMenu(menuId, fields) {
    await db
      .update(menu)
      .set({
        name: fields.name,
        description: fields.description,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(menu.id, menuId))
  },

  async insertItemAtEnd(categoryId, restaurantId, fields) {
    const [{ next }] = await db
      .select({ next: max(item.position) })
      .from(item)
      .where(eq(item.categoryId, categoryId))

    const [row] = await db
      .insert(item)
      .values({
        categoryId,
        restaurantId,
        name: fields.name,
        priceCents: fields.priceCents,
        position: (next ?? -1) + 1,
      })
      .returning({ id: item.id })
    return row.id
  },

  async updateItem(itemId, fields) {
    await db
      .update(item)
      .set({
        name: fields.name,
        description: fields.description,
        priceCents: fields.priceCents,
        available: fields.available,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(item.id, itemId))
  },

  async deleteItem(itemId) {
    await db.delete(item).where(eq(item.id, itemId))
  },

  async reorderItems(categoryId, restaurantId, orderedIds) {
    // Same shape as reorderCategories — single transaction, renumber 0..n-1.
    // AGENTS.md hard rule #7.
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(item)
          .set({ position: i })
          .where(
            and(
              eq(item.id, orderedIds[i]),
              eq(item.categoryId, categoryId),
              eq(item.restaurantId, restaurantId),
            ),
          )
      }
    })
  },

  async getRestaurantLanguageConfig(restaurantId) {
    const rows = await db
      .select({
        defaultLanguage: restaurant.defaultLanguage,
        supportedLanguages: restaurant.supportedLanguages,
      })
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    const row = rows[0]!
    return {
      defaultLanguage: row.defaultLanguage as LanguageCode,
      supportedLanguages: row.supportedLanguages as LanguageCode[],
    }
  },

  async createMenu(restaurantId, name) {
    const [{ next }] = await db
      .select({ next: max(menu.position) })
      .from(menu)
      .where(eq(menu.restaurantId, restaurantId))

    const [row] = await db
      .insert(menu)
      .values({
        restaurantId,
        name,
        position: (next ?? -1) + 1,
      })
      .returning({ id: menu.id })
    return row.id
  },

  async deleteMenu(menuId, restaurantId) {
    await db
      .delete(menu)
      .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
  },

  async seedSampleMenu(restaurantId, seed) {
    // Append after any existing menus so we never reuse a position. The whole
    // seed runs in a transaction (AGENTS.md hard rule #7) so a half-created
    // menu can't leak if anything along the way fails. The caller has
    // pre-localized text into `default` (plain column) + `i18n` (jsonb map)
    // following AGENTS.md hard rule #10.
    const [{ next: nextMenuPos }] = await db
      .select({ next: max(menu.position) })
      .from(menu)
      .where(eq(menu.restaurantId, restaurantId))

    return db.transaction(async (tx) => {
      const [insertedMenu] = await tx
        .insert(menu)
        .values({
          restaurantId,
          name: seed.menuName.default,
          nameI18n: seed.menuName.i18n,
          position: (nextMenuPos ?? -1) + 1,
        })
        .returning({ id: menu.id })

      for (const [catIdx, c] of seed.categories.entries()) {
        const [insertedCategory] = await tx
          .insert(category)
          .values({
            menuId: insertedMenu.id,
            restaurantId,
            name: c.name.default,
            nameI18n: c.name.i18n,
            position: catIdx * 10,
          })
          .returning({ id: category.id })

        const itemRows = c.items.map((it, itemIdx) => ({
          categoryId: insertedCategory.id,
          restaurantId,
          name: it.name.default,
          nameI18n: it.name.i18n,
          description: it.description.default,
          descriptionI18n: it.description.i18n,
          priceCents: it.priceCents,
          currency: it.currency,
          position: itemIdx * 10,
        }))
        if (itemRows.length > 0) await tx.insert(item).values(itemRows)
      }

      return insertedMenu.id
    })
  },
}

/**
 * Production MenuReadPort. Pulls the menu + i18n config + categories with
 * their items in three queries (same shape the page used to issue inline).
 * Returns BuilderCategory[] — the shape the UI consumes directly.
 */
export const drizzleMenuRead: MenuReadPort = {
  async loadBuilderData(restaurantId, menuId) {
    const menuRows = await db
      .select({ id: menu.id, name: menu.name })
      .from(menu)
      .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
      .limit(1)
    if (menuRows.length === 0) {
      return {
        menu: null,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        categories: [],
      }
    }
    const m = menuRows[0]

    const langRows = await db
      .select({
        defaultLanguage: restaurant.defaultLanguage,
        supportedLanguages: restaurant.supportedLanguages,
      })
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    const langs = langRows[0]!

    const categoryRows = await db
      .select()
      .from(category)
      .where(eq(category.menuId, menuId))
      .orderBy(asc(category.position))

    const itemRows =
      categoryRows.length === 0
        ? []
        : await db
            .select()
            .from(item)
            .where(
              inArray(
                item.categoryId,
                categoryRows.map((c) => c.id),
              ),
            )
            .orderBy(asc(item.position))

    const itemsByCategory: Record<string, typeof itemRows> = {}
    for (const c of categoryRows) itemsByCategory[c.id] = []
    for (const it of itemRows) itemsByCategory[it.categoryId]?.push(it)

    return {
      menu: m,
      defaultLanguage: langs.defaultLanguage,
      supportedLanguages: langs.supportedLanguages as string[],
      categories: categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        nameI18n: c.nameI18n as LocalizedText | null,
        descriptionI18n: c.descriptionI18n as LocalizedText | null,
        items: (itemsByCategory[c.id] ?? []).map((it) => ({
          id: it.id,
          categoryId: it.categoryId,
          name: it.name,
          description: it.description,
          nameI18n: it.nameI18n as LocalizedText | null,
          descriptionI18n: it.descriptionI18n as LocalizedText | null,
          priceCents: it.priceCents,
          currency: it.currency,
          available: it.available,
          position: it.position,
          imageUrl: it.imageUrl,
        })),
      })),
    }
  },
}
