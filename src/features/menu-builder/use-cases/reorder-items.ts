import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  categoryId: z.string(),
  restaurantId: z.string(),
  orderedIds: z.array(z.string()),
})

export type ReorderItemsResult =
  | { ok: true; menuId: string }
  | { error: string }

export async function reorderItems(
  port: MenuWritePort,
  raw: unknown,
): Promise<ReorderItemsResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid input' }
  const c = await port.findCategoryInRestaurant(
    parsed.data.categoryId,
    parsed.data.restaurantId,
  )
  if (!c) return { error: 'Category not found in this restaurant' }
  // Reorder + renumber happens in a single transaction inside the adapter
  // (AGENTS.md hard rule #7).
  await port.reorderItems(
    parsed.data.categoryId,
    parsed.data.restaurantId,
    parsed.data.orderedIds,
  )
  return { ok: true, menuId: c.menuId }
}
