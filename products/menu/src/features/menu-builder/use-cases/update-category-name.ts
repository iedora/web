import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  categoryId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(80),
})

export type UpdateCategoryNameResult =
  | { ok: true; menuId: string }
  | { error: string }

export async function updateCategoryName(
  port: MenuWritePort,
  raw: unknown,
): Promise<UpdateCategoryNameResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid name' }
  const c = await port.findCategoryInRestaurant(
    parsed.data.categoryId,
    parsed.data.restaurantId,
  )
  if (!c) return { error: 'Category not found in this restaurant' }
  await port.updateCategoryName(parsed.data.categoryId, parsed.data.name)
  return { ok: true, menuId: c.menuId }
}
