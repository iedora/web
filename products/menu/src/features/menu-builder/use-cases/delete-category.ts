import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  categoryId: z.string(),
  restaurantId: z.string(),
})

export type DeleteCategoryResult =
  | { ok: true; menuId: string }
  | { error: string }

export async function deleteCategory(
  port: MenuWritePort,
  raw: unknown,
): Promise<DeleteCategoryResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid input' }
  const c = await port.findCategoryInRestaurant(
    parsed.data.categoryId,
    parsed.data.restaurantId,
  )
  if (!c) return { error: 'Category not found in this restaurant' }
  await port.deleteCategory(parsed.data.categoryId)
  return { ok: true, menuId: c.menuId }
}
