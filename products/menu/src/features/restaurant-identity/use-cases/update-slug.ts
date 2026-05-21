import 'server-only'
import { z } from 'zod'
import type { IdentityWritePort } from '../ports'

/**
 * Same shape as the auto-gen at onboarding (see `src/app/onboarding/
 * actions.ts::slugify`): 2–40 chars, lowercase alphanumerics + dashes,
 * first/last char must be alphanumeric. Reused here for the manual
 * rename flow so the rules are consistent across surfaces.
 */
const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

const Input = z.object({
  restaurantId: z.string().min(1),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, 'Use 2–40 lowercase letters, numbers, and hyphens.'),
})

export type UpdateSlugResult =
  | { ok: true; slug: string }
  | { ok: false; reason: 'invalid' | 'taken'; message: string }

export async function updateSlug(
  port: IdentityWritePort,
  raw: unknown,
): Promise<UpdateSlugResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid slug.',
    }
  }
  const { restaurantId, slug } = parsed.data
  const res = await port.updateSlug(restaurantId, slug)
  if (!res.ok) {
    return { ok: false, reason: 'taken', message: 'That URL is already taken.' }
  }
  return { ok: true, slug }
}
