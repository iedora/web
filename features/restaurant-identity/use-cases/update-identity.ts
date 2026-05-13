import 'server-only'
import { z } from 'zod'
import { localizedSchema, pruneLocalized } from '@/features/i18n/server'
import type { IdentityWritePort } from '../ports'

// Empty strings collapse to null on the server so the DB doesn't carry "" rows
// that the renderer would treat as truthy and try to render.
const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))

// Logo/banner are managed by the ImageUpload component (uploads commit
// directly via features/upload/actions). This use-case only handles textual
// identity.
const Input = z.object({
  restaurantId: z.string(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: optionalText,
  descriptionI18n: localizedSchema,
})

export type UpdateIdentityResult = { ok: true } | { error: string }

export async function updateIdentity(
  port: IdentityWritePort,
  raw: unknown,
): Promise<UpdateIdentityResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  await port.updateIdentity(parsed.data.restaurantId, {
    name: parsed.data.name,
    description: parsed.data.description,
    descriptionI18n: pruneLocalized(parsed.data.descriptionI18n),
  })
  return { ok: true }
}
