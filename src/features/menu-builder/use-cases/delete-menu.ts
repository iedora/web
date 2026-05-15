import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

const Input = z.object({
  menuId: z.string(),
  restaurantId: z.string(),
})

export type DeleteMenuResult =
  | { ok: true }
  | { error: string }

export async function deleteMenu(
  port: MenuWritePort,
  raw: unknown,
): Promise<DeleteMenuResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { error: 'Invalid input' }
  await port.deleteMenu(parsed.data.menuId, parsed.data.restaurantId)
  return { ok: true }
}
