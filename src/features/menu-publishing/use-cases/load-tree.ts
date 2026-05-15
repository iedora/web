import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { category, item, menu } from '@/shared/db/schema'
import {
  type LanguageCode,
  type LocalizedText,
  localized,
  localizedNullable,
} from '@/features/i18n'
import type { PublicMenu } from '../rsc/types'

// Single source of truth for "fetch a restaurant's menu/category/item tree".
// Returns RAW data — translations, all menus, no language reduction. Callers
// pick filters (activeOnly) and apply `localizeTree` when they want a single
// language for rendering. Keeping the query and the language reduction in
// separate functions means: public page filters active and reduces to the
// visitor's language; theme dashboard fetches everything at default language
// for the live preview without duplicating the joins.

export type RawItem = {
  id: string
  categoryId: string
  name: string
  nameI18n: LocalizedText | null
  description: string | null
  descriptionI18n: LocalizedText | null
  priceCents: number
  currency: string
  available: boolean
  position: number
  imageUrl: string | null
  tags: string[]
}

export type RawCategory = {
  id: string
  menuId: string
  name: string
  nameI18n: LocalizedText | null
  description: string | null
  descriptionI18n: LocalizedText | null
  position: number
  items: RawItem[]
}

export type RawMenu = {
  id: string
  name: string
  nameI18n: LocalizedText | null
  description: string | null
  descriptionI18n: LocalizedText | null
  active: boolean
  position: number
  categories: RawCategory[]
}

export async function loadMenuTree(opts: {
  restaurantId: string
  activeOnly?: boolean
}): Promise<RawMenu[]> {
  const { restaurantId, activeOnly = false } = opts

  const menuFilter = activeOnly
    ? and(eq(menu.restaurantId, restaurantId), eq(menu.active, true))
    : eq(menu.restaurantId, restaurantId)

  const menus = await db
    .select()
    .from(menu)
    .where(menuFilter)
    .orderBy(asc(menu.position))
  if (menus.length === 0) return []

  const categories = await db
    .select()
    .from(category)
    .where(
      inArray(
        category.menuId,
        menus.map((m) => m.id),
      ),
    )
    .orderBy(asc(category.position))

  const items =
    categories.length === 0
      ? []
      : await db
          .select()
          .from(item)
          .where(
            inArray(
              item.categoryId,
              categories.map((c) => c.id),
            ),
          )
          .orderBy(asc(item.position))

  const itemsByCategory = new Map<string, RawItem[]>()
  for (const c of categories) itemsByCategory.set(c.id, [])
  for (const it of items) {
    itemsByCategory.get(it.categoryId)?.push({
      id: it.id,
      categoryId: it.categoryId,
      name: it.name,
      nameI18n: it.nameI18n as LocalizedText | null,
      description: it.description,
      descriptionI18n: it.descriptionI18n as LocalizedText | null,
      priceCents: it.priceCents,
      currency: it.currency,
      available: it.available,
      position: it.position,
      imageUrl: it.imageUrl,
      tags: (it.tags as string[] | null) ?? [],
    })
  }

  const categoriesByMenu = new Map<string, RawCategory[]>()
  for (const m of menus) categoriesByMenu.set(m.id, [])
  for (const c of categories) {
    categoriesByMenu.get(c.menuId)?.push({
      id: c.id,
      menuId: c.menuId,
      name: c.name,
      nameI18n: c.nameI18n as LocalizedText | null,
      description: c.description,
      descriptionI18n: c.descriptionI18n as LocalizedText | null,
      position: c.position,
      items: itemsByCategory.get(c.id) ?? [],
    })
  }

  return menus.map((m) => ({
    id: m.id,
    name: m.name,
    nameI18n: m.nameI18n as LocalizedText | null,
    description: m.description,
    descriptionI18n: m.descriptionI18n as LocalizedText | null,
    active: m.active,
    position: m.position,
    categories: categoriesByMenu.get(m.id) ?? [],
  }))
}

// Reduce a raw tree to the renderer's `PublicMenu[]` shape, picking a single
// string per field via the i18n format helpers. Pass the same code for
// `currentLanguage` and `defaultLanguage` to render the row's plain text
// columns (i.e. the source-of-truth strings) without consulting overrides.
export function localizeTree(
  tree: RawMenu[],
  currentLanguage: LanguageCode,
  defaultLanguage: LanguageCode,
): PublicMenu[] {
  return tree.map((m) => ({
    id: m.id,
    name: localized(m.name, m.nameI18n, currentLanguage, defaultLanguage),
    description: localizedNullable(
      m.description,
      m.descriptionI18n,
      currentLanguage,
      defaultLanguage,
    ),
    categories: m.categories.map((c) => ({
      id: c.id,
      name: localized(c.name, c.nameI18n, currentLanguage, defaultLanguage),
      description: localizedNullable(
        c.description,
        c.descriptionI18n,
        currentLanguage,
        defaultLanguage,
      ),
      items: c.items.map((it) => ({
        id: it.id,
        name: localized(it.name, it.nameI18n, currentLanguage, defaultLanguage),
        description: localizedNullable(
          it.description,
          it.descriptionI18n,
          currentLanguage,
          defaultLanguage,
        ),
        priceCents: it.priceCents,
        currency: it.currency,
        available: it.available,
        tags: it.tags,
        imageUrl: it.imageUrl,
      })),
    })),
  }))
}
