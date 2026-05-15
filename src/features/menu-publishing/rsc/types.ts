import type { ResolvedTheme } from './theme'

export type PublicRestaurant = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
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
