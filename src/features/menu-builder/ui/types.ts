import type { LocalizedText } from '@/features/i18n'

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
}

export type BuilderCategory = {
  id: string
  name: string
  description: string | null
  nameI18n: LocalizedText | null
  descriptionI18n: LocalizedText | null
  items: BuilderItem[]
}
