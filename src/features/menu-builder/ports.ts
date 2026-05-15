import type { LanguageCode, LocalizedText } from '@/features/i18n'
import type { BuilderCategory } from './ui/types'

/**
 * Sample-menu seed payload shape — passed into `seedSampleMenu` so the
 * use-case stays I/O-free. The actual sample data lives in
 * `@/features/menu-publishing` and is supplied by the action shell.
 */
export type SampleMenuSeed = {
  menuName: { default: string; i18n: LocalizedText | null }
  categories: ReadonlyArray<{
    name: { default: string; i18n: LocalizedText | null }
    items: ReadonlyArray<{
      name: { default: string; i18n: LocalizedText | null }
      description: { default: string; i18n: LocalizedText | null }
      priceCents: number
      currency: string
    }>
  }>
}

/**
 * MenuWritePort — every DB mutation the builder needs.
 *
 * The use-cases call methods on this interface; production wires it to
 * `drizzleMenuWrite` (Drizzle + Postgres). Tests wire fakes. Keep the surface
 * minimal — one method per atomic operation. Authorization happens in the
 * action shell (AGENTS.md hard rule #1); the port assumes the caller has
 * already verified `restaurantId` ownership.
 */
export interface MenuWritePort {
  /** Returns the menu's parent id, or null when the menu doesn't belong to the restaurant. */
  findMenuInRestaurant(
    menuId: string,
    restaurantId: string,
  ): Promise<{ id: string } | null>

  /** Returns the category's parent menuId, or null when not in the restaurant. */
  findCategoryInRestaurant(
    categoryId: string,
    restaurantId: string,
  ): Promise<{ id: string; menuId: string } | null>

  /** Returns the item's parent categoryId, or null when not in the restaurant. */
  findItemInRestaurant(
    itemId: string,
    restaurantId: string,
  ): Promise<{ id: string; categoryId: string } | null>

  // ─── Categories ─────────────────────────────────────────────────────────────
  insertCategoryAtEnd(
    menuId: string,
    restaurantId: string,
    name: string,
  ): Promise<string>

  updateCategoryName(categoryId: string, name: string): Promise<void>

  updateCategoryTranslations(
    categoryId: string,
    fields: {
      name: string
      description: string | null
      nameI18n: LocalizedText | null
      descriptionI18n: LocalizedText | null
    },
  ): Promise<void>

  deleteCategory(categoryId: string): Promise<void>

  /**
   * Reorders the given categories in a single transaction (AGENTS.md hard
   * rule #7). The caller must have verified `menuId` ownership upstream.
   */
  reorderCategories(
    menuId: string,
    restaurantId: string,
    orderedIds: string[],
  ): Promise<void>

  // ─── Menu ───────────────────────────────────────────────────────────────────
  updateMenu(
    menuId: string,
    fields: {
      name: string
      description: string | null
      nameI18n: LocalizedText | null
      descriptionI18n: LocalizedText | null
    },
  ): Promise<void>

  // ─── Items ──────────────────────────────────────────────────────────────────
  insertItemAtEnd(
    categoryId: string,
    restaurantId: string,
    fields: { name: string; priceCents: number },
  ): Promise<string>

  updateItem(
    itemId: string,
    fields: {
      name: string
      description: string | null
      priceCents: number
      available: boolean
      nameI18n: LocalizedText | null
      descriptionI18n: LocalizedText | null
    },
  ): Promise<void>

  deleteItem(itemId: string): Promise<void>

  /**
   * Reorders the items inside a category in a single transaction
   * (AGENTS.md hard rule #7).
   */
  reorderItems(
    categoryId: string,
    restaurantId: string,
    orderedIds: string[],
  ): Promise<void>

  // ─── Menu CRUD (restaurant-home page) ───────────────────────────────────────
  /**
   * Reads the restaurant's language config — needed by the seed flow to pick
   * the default-language plain text and decide which i18n keys to populate.
   */
  getRestaurantLanguageConfig(restaurantId: string): Promise<{
    defaultLanguage: LanguageCode
    supportedLanguages: LanguageCode[]
  }>

  /** Appends a new menu after any existing menus. Returns the new menu id. */
  createMenu(restaurantId: string, name: string): Promise<string>

  /** Deletes a menu (scoped to its restaurant — defence in depth). */
  deleteMenu(menuId: string, restaurantId: string): Promise<void>

  /**
   * Seeds a sample menu in a single transaction (AGENTS.md hard rule #7 +
   * #10). Returns the new menu id. The caller supplies the localized seed
   * payload so this port stays detached from the sample-data module.
   */
  seedSampleMenu(
    restaurantId: string,
    seed: SampleMenuSeed,
  ): Promise<string>
}

/**
 * MenuReadPort — page-level RSC data fetch.
 *
 * `loadBuilderData` returns the shape the builder UI needs: the menu row
 * (or null when missing), the restaurant's language config, and the
 * categories with their items already grouped.
 */
export interface MenuReadPort {
  loadBuilderData(
    restaurantId: string,
    menuId: string,
  ): Promise<{
    menu: { id: string; name: string } | null
    defaultLanguage: string
    supportedLanguages: string[]
    categories: BuilderCategory[]
  }>
}
