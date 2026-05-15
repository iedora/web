'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantBySlug } from '@/features/auth'
import { revalidateRestaurant } from '@/features/menu-publishing'
import type { LocalizedText } from '@/features/i18n'
import { drizzleMenuWrite } from './adapters/drizzle'
import { createCategory as runCreateCategory } from './use-cases/create-category'
import { updateCategoryName as runUpdateCategoryName } from './use-cases/update-category-name'
import { updateCategoryTranslations as runUpdateCategoryTranslations } from './use-cases/update-category-translations'
import { deleteCategory as runDeleteCategory } from './use-cases/delete-category'
import { reorderCategories as runReorderCategories } from './use-cases/reorder-categories'
import { updateMenu as runUpdateMenu } from './use-cases/update-menu'
import { createItem as runCreateItem } from './use-cases/create-item'
import { updateItem as runUpdateItem } from './use-cases/update-item'
import { deleteItem as runDeleteItem } from './use-cases/delete-item'
import { reorderItems as runReorderItems } from './use-cases/reorder-items'
import { createMenu as runCreateMenu } from './use-cases/create-menu'
import { deleteMenu as runDeleteMenu } from './use-cases/delete-menu'
import { seedSampleMenu as runSeedSampleMenu } from './use-cases/seed-sample-menu'

/**
 * Server action shells — each one: auth guard → run use-case → revalidate.
 * Every mutation that affects the public menu calls `revalidateRestaurant`
 * (AGENTS.md hard rule #12). The dashboard path revalidation is kept on
 * purpose — tag-only invalidation is a later step in the migration.
 */
function revalidateMenu(slug: string, menuId: string) {
  revalidatePath(`/dashboard/r/${slug}/m/${menuId}`)
  revalidateRestaurant(slug)
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function createCategory(slug: string, menuId: string, name: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runCreateCategory(drizzleMenuWrite, {
    menuId,
    restaurantId: r.id,
    name,
  })
  if ('ok' in res) revalidateMenu(slug, menuId)
  return res
}

export async function updateCategoryName(
  slug: string,
  categoryId: string,
  name: string,
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateCategoryName(drizzleMenuWrite, {
    categoryId,
    restaurantId: r.id,
    name,
  })
  if ('ok' in res) revalidateMenu(slug, res.menuId)
  return 'ok' in res
    ? { ok: true as const, restaurantId: r.id }
    : { error: res.error }
}

export async function updateCategoryTranslations(
  slug: string,
  categoryId: string,
  fields: {
    name: string
    description?: string
    nameI18n?: LocalizedText
    descriptionI18n?: LocalizedText
  },
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateCategoryTranslations(drizzleMenuWrite, {
    categoryId,
    restaurantId: r.id,
    ...fields,
  })
  if ('ok' in res) revalidateMenu(slug, res.menuId)
  return 'ok' in res ? { ok: true as const } : { error: res.error }
}

export async function deleteCategory(slug: string, categoryId: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runDeleteCategory(drizzleMenuWrite, {
    categoryId,
    restaurantId: r.id,
  })
  if ('ok' in res) revalidateMenu(slug, res.menuId)
}

export async function reorderCategories(
  slug: string,
  menuId: string,
  orderedIds: string[],
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runReorderCategories(drizzleMenuWrite, {
    menuId,
    restaurantId: r.id,
    orderedIds,
  })
  if ('ok' in res) revalidateMenu(slug, menuId)
}

// ─── Menu (rename + translations) ─────────────────────────────────────────────

export async function updateMenu(
  slug: string,
  menuId: string,
  fields: {
    name: string
    description?: string
    nameI18n?: LocalizedText
    descriptionI18n?: LocalizedText
  },
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateMenu(drizzleMenuWrite, {
    menuId,
    restaurantId: r.id,
    ...fields,
  })
  if ('ok' in res) revalidateMenu(slug, menuId)
  return 'ok' in res ? { ok: true as const } : { error: res.error }
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function createItem(
  slug: string,
  categoryId: string,
  fields: { name: string; priceCents: number },
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runCreateItem(drizzleMenuWrite, {
    categoryId,
    restaurantId: r.id,
    ...fields,
  })
  if ('ok' in res) revalidateMenu(slug, res.menuId)
  return 'ok' in res ? { ok: true as const } : { error: res.error }
}

export async function updateItem(
  slug: string,
  itemId: string,
  fields: {
    name: string
    description?: string
    priceCents: number
    available?: boolean
    nameI18n?: LocalizedText
    descriptionI18n?: LocalizedText
  },
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateItem(drizzleMenuWrite, {
    itemId,
    restaurantId: r.id,
    ...fields,
  })
  // No menuId in scope — revalidate the whole restaurant subtree (admin)
  // plus the public page via the slug tag.
  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`, 'layout')
    revalidateRestaurant(slug)
    return { ok: true as const, categoryId: res.categoryId }
  }
  return { error: res.error }
}

export async function deleteItem(slug: string, itemId: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runDeleteItem(drizzleMenuWrite, {
    itemId,
    restaurantId: r.id,
  })
  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`, 'layout')
    revalidateRestaurant(slug)
  }
}

export async function reorderItems(
  slug: string,
  categoryId: string,
  orderedIds: string[],
) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runReorderItems(drizzleMenuWrite, {
    categoryId,
    restaurantId: r.id,
    orderedIds,
  })
  if ('ok' in res) revalidateMenu(slug, res.menuId)
}

// ─── Menu CRUD (restaurant-home page) ─────────────────────────────────────────

export async function createMenu(slug: string, formData: FormData) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runCreateMenu(drizzleMenuWrite, {
    restaurantId: r.id,
    name: formData.get('name'),
  })
  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`)
    revalidateRestaurant(slug)
    return { ok: true as const }
  }
  return { error: res.error }
}

export async function deleteMenu(slug: string, menuId: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runDeleteMenu(drizzleMenuWrite, {
    menuId,
    restaurantId: r.id,
  })
  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`)
    revalidateRestaurant(slug)
  }
}

export async function seedSampleMenu(slug: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runSeedSampleMenu(drizzleMenuWrite, { restaurantId: r.id })
  revalidatePath(`/dashboard/r/${slug}`)
  revalidateRestaurant(slug)
  return { ok: true as const, menuId: res.menuId }
}
