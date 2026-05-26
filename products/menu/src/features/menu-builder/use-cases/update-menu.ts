import 'server-only'
import { z } from 'zod'
import { localizedSchema, pruneLocalized } from '@/features/i18n/server'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  menuId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  nameI18n: localizedSchema,
  descriptionI18n: localizedSchema,
})

export type UpdateMenuResult = { ok: true } | { error: string }

export async function updateMenu(
  port: MenuWritePort,
  raw: unknown,
): Promise<UpdateMenuResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const found = await port.findMenuInRestaurant(
    parsed.data.menuId,
    parsed.data.restaurantId,
  )
  if (!found) return { error: 'Menu not found in this restaurant' }
  await port.updateMenu(parsed.data.menuId, {
    name: parsed.data.name,
    description: parsed.data.description || null,
    nameI18n: pruneLocalized(parsed.data.nameI18n),
    descriptionI18n: pruneLocalized(parsed.data.descriptionI18n),
  })
  return { ok: true }
}
