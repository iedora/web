import type { ResolvedTheme } from './theme'

export type PublicRestaurant = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
}

/**
 * One alternate price for a dish — "Meia dose", "Imperial", "Jarra 1L".
 * Operator-authored; render label as-written.
 */
export type PublicVariant = {
  label: string
  priceCents: number
}

export type PublicItem = {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  available: boolean
  tags: string[]
  imageUrl: string | null
  /**
   * Ad-hoc price variants alongside the primary `priceCents`. Empty
   * array (not null) when the item has a single price — keeps the
   * templates' iteration code branch-free.
   */
  variants: PublicVariant[]
}

export type PublicCategory = {
  id: string
  name: string
  description: string | null
  items: PublicItem[]
}

export type PublicMenu = {
  id: string
  name: string
  description: string | null
  categories: PublicCategory[]
}

export type PublicMenuData = {
  restaurant: PublicRestaurant
  menus: PublicMenu[]
}

export type RenderProps = PublicMenuData & { theme: ResolvedTheme }
