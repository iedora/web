'use server'

import { revalidatePath } from 'next/cache'
import { ApiError } from '@iedora/api-client'
import type { LocalizedText } from '../i18n'
import * as api from '../../shared/api'

/**
 * Server action shells — thin wrappers over the Go menu API. The Go
 * service owns ALL validation, tenancy and ownership checks (the
 * Bearer token scopes every call); these only translate errors to the
 * `{ error }` shape the dialogs render, then revalidate the dashboard
 * paths so the router cache refetches.
 *
 * NOTE: the Go update endpoints REPLACE the full text field set
 * (name + description + i18n), so every updating action must receive
 * the complete fields from the UI (which has the tree in memory).
 */

type Variants = ReadonlyArray<{
  label: string
  labelI18n?: LocalizedText | null
  priceCents: number
}>

function toVariants(variants?: Variants): api.Variant[] | undefined {
  return variants?.map((v) => ({
    label: v.label,
    labelI18n: v.labelI18n ?? undefined,
    priceCents: v.priceCents,
  }))
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong'
}

function revalidateMenu(slug: string, menuId: string) {
  revalidatePath(`/menu/dashboard/r/${slug}/m/${menuId}`)
  revalidatePath(`/menu/r/${slug}`)
}

function revalidateRestaurantPages(slug: string) {
  revalidatePath(`/menu/dashboard/r/${slug}`, 'layout')
  revalidatePath(`/menu/r/${slug}`)
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function createCategory(slug: string, menuId: string, name: string) {
  try {
    await api.createCategory(slug, menuId, name)
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateMenu(slug, menuId)
  return { ok: true as const }
}

export async function updateCategoryName(
  slug: string,
  categoryId: string,
  fields: {
    name: string
    description?: string
    nameI18n?: LocalizedText
    descriptionI18n?: LocalizedText
  },
) {
  return updateCategoryTranslations(slug, categoryId, fields)
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
  try {
    await api.updateCategory(slug, categoryId, fields)
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateRestaurantPages(slug)
  return { ok: true as const }
}

export async function deleteCategory(slug: string, categoryId: string) {
  try {
    await api.deleteCategory(slug, categoryId)
  } catch {
    return
  }
  revalidateRestaurantPages(slug)
}

export async function reorderCategories(
  slug: string,
  menuId: string,
  orderedIds: string[],
) {
  try {
    await api.reorderCategories(slug, menuId, orderedIds)
  } catch {
    return
  }
  revalidateMenu(slug, menuId)
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
    active?: boolean
  },
) {
  try {
    await api.updateMenu(slug, menuId, { ...fields, active: fields.active ?? true })
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateMenu(slug, menuId)
  return { ok: true as const }
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function createItem(
  slug: string,
  categoryId: string,
  fields: {
    name: string
    priceCents: number
    /** Optional initial variants (½ dose, alcohol-free, large, …). */
    variants?: Variants
  },
) {
  try {
    await api.createItem(slug, categoryId, {
      name: fields.name,
      priceCents: fields.priceCents,
      variants: toVariants(fields.variants),
    })
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateRestaurantPages(slug)
  return { ok: true as const }
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
    /** Pass `undefined` to leave variants alone; `[]` to clear them. */
    variants?: Variants
  },
) {
  try {
    await api.updateItem(slug, itemId, {
      name: fields.name,
      description: fields.description,
      nameI18n: fields.nameI18n,
      descriptionI18n: fields.descriptionI18n,
      priceCents: fields.priceCents,
      available: fields.available,
      variants: toVariants(fields.variants),
    })
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateRestaurantPages(slug)
  return { ok: true as const }
}

export async function deleteItem(slug: string, itemId: string) {
  try {
    await api.deleteItem(slug, itemId)
  } catch {
    return
  }
  revalidateRestaurantPages(slug)
}

export async function reorderItems(
  slug: string,
  categoryId: string,
  orderedIds: string[],
) {
  try {
    await api.reorderItems(slug, categoryId, orderedIds)
  } catch {
    return
  }
  revalidateRestaurantPages(slug)
}

// ─── Menu CRUD (restaurant-home page) ─────────────────────────────────────────

export async function createMenu(slug: string, formData: FormData) {
  const name = String(formData.get('name') ?? '')
  try {
    await api.createMenu(slug, name)
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateRestaurantPages(slug)
  return { ok: true as const }
}

export async function deleteMenu(slug: string, menuId: string) {
  try {
    await api.deleteMenu(slug, menuId)
  } catch {
    return
  }
  revalidateRestaurantPages(slug)
}

export async function seedSampleMenu(slug: string) {
  let menuId: string
  try {
    ;({ menuId } = await api.seedSampleMenu(slug))
  } catch (err) {
    return { error: errorMessage(err) }
  }
  revalidateRestaurantPages(slug)
  return { ok: true as const, menuId }
}
