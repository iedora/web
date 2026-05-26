import 'server-only'
import { z } from 'zod'
import type { RestaurantTheme } from '@/shared/db/schema'
import { FONTS, HEX_PATTERN, LAYOUTS } from '@/features/menu-publishing/rsc/theme'
import type { IdentityWritePort } from '../ports'

// LAYOUTS comes from the templates registry (AGENTS.md hard rule #8) — the
// enum here is derived at module load, so adding a template just shows up.
const Input = z.object({
  restaurantId: z.string(),
  layout: z.enum(LAYOUTS.map((l) => l.id) as [string, ...string[]]),
  font: z.enum(FONTS.map((f) => f.id) as [string, ...string[]]),
  primaryColor: z.string().regex(HEX_PATTERN, 'Must be a #RRGGBB hex color'),
  secondaryColor: z.string().regex(HEX_PATTERN, 'Must be a #RRGGBB hex color'),
})

export type UpdateThemeResult = { ok: true } | { error: string }

export async function updateTheme(
  port: IdentityWritePort,
  raw: unknown,
): Promise<UpdateThemeResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid theme' }
  }
  const { restaurantId, ...theme } = parsed.data
  await port.updateTheme(restaurantId, theme as RestaurantTheme)
  return { ok: true }
}
