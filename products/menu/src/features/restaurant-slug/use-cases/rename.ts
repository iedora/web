import { z } from 'zod'
import { isValidSlugShape } from './slugify'
import type { SlugRegistry } from '../ports'

/**
 * Same shape rule the auto-gen uses at onboarding: 2–40 chars,
 * lowercase alphanumeric + dashes, must start AND end with
 * alphanumeric. The boundary lives here so the dashboard slug-editor
 * + the (future) admin rename surface enforce the same contract.
 */
const Input = z.object({
  restaurantId: z.string().min(1),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidSlugShape, {
      message: 'Use 2–40 lowercase letters, numbers, and hyphens.',
    }),
})

export type RenameResult =
  | { ok: true; slug: string }
  | { ok: false; reason: 'invalid' | 'taken'; message: string }

export async function rename(
  registry: SlugRegistry,
  raw: unknown,
): Promise<RenameResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid slug.',
    }
  }
  const { restaurantId, slug } = parsed.data
  const res = await registry.rename(restaurantId, slug)
  if (!res.ok) {
    return { ok: false, reason: 'taken', message: 'That URL is already taken.' }
  }
  return { ok: true, slug }
}
