import 'server-only'
import { z } from 'zod'
import { localizedSchema, pruneLocalized } from '@/features/i18n/server'
import type { MenuWritePort } from '../ports'

// Money is integer cents (AGENTS.md hard rule #6).
const VariantInput = z.object({
  label: z.string().trim().min(1).max(120),
  /** Optional translations of the label keyed by language code. */
  labelI18n: localizedSchema.optional(),
  priceCents: z.number().int().min(0).max(100_000_00),
})

const Input = z.object({
  itemId: z.string(),
  restaurantId: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  priceCents: z.number().int().min(0).max(100_000_00),
  available: z.boolean().optional(),
  nameI18n: localizedSchema,
  descriptionI18n: localizedSchema,
  // `undefined` = leave alone; `[]` = explicitly clear all variants.
  variants: z.array(VariantInput).optional(),
})

export type UpdateItemResult =
  | { ok: true; categoryId: string }
  | { error: string }

export async function updateItem(
  port: MenuWritePort,
  raw: unknown,
): Promise<UpdateItemResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid item' }
  }
  const existing = await port.findItemInRestaurant(
    parsed.data.itemId,
    parsed.data.restaurantId,
  )
  if (!existing) return { error: 'Item not found in this restaurant' }
  // Prune empty translation entries on each variant's labelI18n so the
  // jsonb column doesn't accumulate dead `"": ""` keys when the operator
  // clears a translation field.
  const variants = parsed.data.variants?.map((v) => ({
    label: v.label,
    labelI18n: v.labelI18n ? pruneLocalized(v.labelI18n) : null,
    priceCents: v.priceCents,
  }))

  await port.updateItem(parsed.data.itemId, {
    name: parsed.data.name,
    description: parsed.data.description || null,
    priceCents: parsed.data.priceCents,
    available: parsed.data.available ?? true,
    nameI18n: pruneLocalized(parsed.data.nameI18n),
    descriptionI18n: pruneLocalized(parsed.data.descriptionI18n),
    variants,
  })
  return { ok: true, categoryId: existing.categoryId }
}
