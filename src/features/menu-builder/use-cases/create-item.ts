import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

// Money is integer cents (AGENTS.md hard rule #6). Cap at 100_000_00 = €100k.
const Input = z.object({
  categoryId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0).max(100_000_00),
})

export type CreateItemResult =
  | { ok: true; id: string; menuId: string }
  | { error: string }

export async function createItem(
  port: MenuWritePort,
  raw: unknown,
): Promise<CreateItemResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid item' }
  }
  const c = await port.findCategoryInRestaurant(
    parsed.data.categoryId,
    parsed.data.restaurantId,
  )
  if (!c) return { error: 'Category not found in this restaurant' }
  const id = await port.insertItemAtEnd(
    parsed.data.categoryId,
    parsed.data.restaurantId,
    { name: parsed.data.name, priceCents: parsed.data.priceCents },
  )
  return { ok: true, id, menuId: c.menuId }
}
