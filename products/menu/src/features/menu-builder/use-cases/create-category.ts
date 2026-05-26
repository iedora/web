import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

// Schema kept verbatim from the original actions.ts — just relocated.
const Input = z.object({
  menuId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(80),
})

export type CreateCategoryResult =
  | { ok: true; id: string }
  | { error: string }

export async function createCategory(
  port: MenuWritePort,
  raw: unknown,
): Promise<CreateCategoryResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid name' }
  const found = await port.findMenuInRestaurant(
    parsed.data.menuId,
    parsed.data.restaurantId,
  )
  if (!found) return { error: 'Menu not found in this restaurant' }
  const id = await port.insertCategoryAtEnd(
    parsed.data.menuId,
    parsed.data.restaurantId,
    parsed.data.name,
  )
  return { ok: true, id }
}
