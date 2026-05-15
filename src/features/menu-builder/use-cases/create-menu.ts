import 'server-only'
import { z } from 'zod'
import type { MenuWritePort } from '../ports'

// Same shape the original `app/dashboard/r/[slug]/actions.ts#createMenu`
// expected — name validated server-side, trim before length checks.
const Input = z.object({
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(80),
})

export type CreateMenuResult =
  | { ok: true; id: string }
  | { error: string }

export async function createMenu(
  port: MenuWritePort,
  raw: unknown,
): Promise<CreateMenuResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name' }
  }
  const id = await port.createMenu(parsed.data.restaurantId, parsed.data.name)
  return { ok: true, id }
}
