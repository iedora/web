import 'server-only'
import { cache } from 'react'
import { getMenuTree, type CategoryNode, type ItemNode } from '../../shared/api'
import type { BuilderCategory, BuilderItem } from './ui/types'

/**
 * Public API of the menu-builder slice.
 *
 * Server actions live at `@/features/menu-builder/actions` (Next 'use server'
 * rules don't traverse barrels reliably). The DnD client components live at
 * `@/features/menu-builder/ui/*` and are imported directly.
 *
 * `loadBuilderData` is wrapped in React's `cache()` so a guard called twice
 * in a single render (page + child RSC) hits the API once. Ownership is
 * enforced by the Go service (the tree call 404s for foreign slugs).
 */
export const loadBuilderData = cache(async (slug: string, menuId: string) => {
  const tree = await getMenuTree(slug)
  const menu = tree.menus.find((m) => m.id === menuId)
  if (!menu) return null
  return {
    menu: { id: menu.id, name: menu.name },
    defaultLanguage: tree.defaultLanguage,
    supportedLanguages: tree.supportedLanguages,
    categories: menu.categories.map(toBuilderCategory),
  }
})

function toBuilderCategory(c: CategoryNode): BuilderCategory {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    nameI18n: c.nameI18n ?? null,
    descriptionI18n: c.descriptionI18n ?? null,
    items: c.items.map(toBuilderItem),
  }
}

function toBuilderItem(i: ItemNode): BuilderItem {
  return {
    id: i.id,
    categoryId: i.categoryId,
    name: i.name,
    description: i.description ?? null,
    nameI18n: i.nameI18n ?? null,
    descriptionI18n: i.descriptionI18n ?? null,
    priceCents: i.priceCents,
    currency: i.currency,
    available: i.available,
    position: i.position,
    imageUrl: i.imageUrl ?? null,
    variants: i.variants.map((v) => ({
      label: v.label,
      labelI18n: v.labelI18n ?? null,
      priceCents: v.priceCents,
    })),
  }
}

export type { BuilderCategory, BuilderItem } from './ui/types'
