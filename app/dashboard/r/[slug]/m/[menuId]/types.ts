export type BuilderItem = {
  id: string
  categoryId: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  available: boolean
  position: number
}

export type BuilderCategory = {
  id: string
  name: string
  items: BuilderItem[]
}
