import 'server-only'
import { z } from 'zod'
import { localizedSchema, pruneLocalized } from '@/features/i18n/server'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  categoryId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  nameI18n: localizedSchema,
  descriptionI18n: localizedSchema,
})

export type UpdateCategoryTranslationsResult =
  | { ok: true; menuId: string }
  | { error: string }

export async function updateCategoryTranslations(
  port: MenuWritePort,
  raw: unknown,
): Promise<UpdateCategoryTranslationsResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const c = await port.findCategoryInRestaurant(
    parsed.data.categoryId,
    parsed.data.restaurantId,
  )
  if (!c) return { error: 'Category not found in this restaurant' }
  await port.updateCategoryTranslations(parsed.data.categoryId, {
    name: parsed.data.name,
    description: parsed.data.description || null,
    nameI18n: pruneLocalized(parsed.data.nameI18n),
    descriptionI18n: pruneLocalized(parsed.data.descriptionI18n),
  })
  return { ok: true, menuId: c.menuId }
}
