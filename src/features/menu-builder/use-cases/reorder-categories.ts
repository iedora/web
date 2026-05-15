import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  menuId: z.string(),
  restaurantId: z.string(),
  orderedIds: z.array(z.string()),
})

export type ReorderCategoriesResult =
  | { ok: true }
  | { error: string }

export async function reorderCategories(
  port: MenuWritePort,
  raw: unknown,
): Promise<ReorderCategoriesResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid input' }
  const found = await port.findMenuInRestaurant(
    parsed.data.menuId,
    parsed.data.restaurantId,
  )
  if (!found) return { error: 'Menu not found in this restaurant' }
  // Reorder + renumber happens in a single transaction inside the adapter
  // (AGENTS.md hard rule #7).
  await port.reorderCategories(
    parsed.data.menuId,
    parsed.data.restaurantId,
    parsed.data.orderedIds,
  )
  return { ok: true }
}
