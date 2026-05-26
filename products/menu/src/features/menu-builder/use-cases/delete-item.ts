import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  itemId: z.string(),
  restaurantId: z.string(),
})

export type DeleteItemResult =
  | { ok: true; categoryId: string }
  | { error: string }

export async function deleteItem(
  port: MenuWritePort,
  raw: unknown,
): Promise<DeleteItemResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid input' }
  const existing = await port.findItemInRestaurant(
    parsed.data.itemId,
    parsed.data.restaurantId,
  )
  if (!existing) return { error: 'Item not found in this restaurant' }
  await port.deleteItem(parsed.data.itemId)
  return { ok: true, categoryId: existing.categoryId }
}
