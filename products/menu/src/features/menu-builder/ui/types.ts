import type { LocalizedText } from '@/features/i18n'

/**
 * Ad-hoc price variant on an item — "Meia dose", "Imperial", "Jarra 1L".
 * Some restaurants carry 3–4 variants per dish (Dose / Meia dose /
 * Cuvete / Take-away). The builder UI must scale to N variants.
 */
export type BuilderVariant = {
  /** Source/default-language label. */
  label: string
  /** Translations into non-default languages — null when none yet. */
  labelI18n: LocalizedText | null
  priceCents: number
}

export type BuilderItem = {
  id: string
  categoryId: string
  name: string
  description: string | null
  nameI18n: LocalizedText | null
  descriptionI18n: LocalizedText | null
  priceCents: number
  currency: string
  available: boolean
  position: number
  imageUrl: string | null
  variants: BuilderVariant[]
}

export type BuilderCategory = {
  id: string
  name: string
  description: string | null
  nameI18n: LocalizedText | null
  descriptionI18n: LocalizedText | null
  items: BuilderItem[]
}
