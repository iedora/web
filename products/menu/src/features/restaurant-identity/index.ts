import 'server-only'
import { cache } from 'react'
import * as api from '../../shared/api'
import type { PublicMenu } from '../menu-publishing/rsc/types'

/**
 * Public API of the restaurant-identity slice.
 *
 * Server actions live at `@/features/restaurant-identity/actions` (Next
 * 'use server' rules don't traverse barrels reliably). The client UI lives
 * at `@/features/restaurant-identity/ui/*` and is imported directly.
 *
 * Identity reads come straight off `requireRestaurantBySlug` (the Go
 * Restaurant DTO carries theme, languages and description i18n) — the
 * old per-field loaders are gone. What remains here are the two
 * cross-cutting read loaders the dashboard pages need.
 */

export type { StaffRestaurantRow } from '../../shared/api'

/**
 * Staff-only cross-tenant restaurant directory (admin restaurants
 * page). The Go service enforces the staff role on the token; the page
 * gates with `requireStaff` first so non-staff never see the surface.
 */
export const listRestaurantsDirectory = cache(async (q?: string) => {
  const { restaurants } = await api.staffDirectory(q)
  return restaurants
})

/**
 * Active menus of one restaurant projected into the public render
 * shape, in the restaurant's default language — feeds the theme
 * editor's live preview. Ownership is enforced by the Go service
 * (the tree call 404s for foreign slugs).
 */
export const loadThemePreviewMenus = cache(async (slug: string): Promise<PublicMenu[]> => {
  const tree = await api.getMenuTree(slug)
  return tree.menus
    .filter((m) => m.active)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      categories: m.categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        // Preview parity with the public read model: unavailable items
        // don't render on the guest menu, so they don't preview either.
        items: c.items
          .filter((i) => i.available)
          .map((i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            priceCents: i.priceCents,
            currency: i.currency,
            imageUrl: i.imageUrl,
            tags: i.tags,
            variants: i.variants.map((v) => ({ label: v.label, priceCents: v.priceCents })),
          })),
      })),
    }))
})
