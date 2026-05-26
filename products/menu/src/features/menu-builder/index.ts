import 'server-only'
import { cache } from 'react'
import { drizzleMenuRead } from './adapters/drizzle'
import { loadBuilderData as _loadBuilderData } from './use-cases/load-builder-data'

/**
 * Public API of the menu-builder slice.
 *
 * Server actions live at `@/features/menu-builder/actions` (Next 'use server'
 * rules don't traverse barrels reliably). The DnD client components live at
 * `@/features/menu-builder/ui/*` and are imported directly.
 *
 * `loadBuilderData` is wrapped in React's `cache()` so a guard called twice
 * in a single render (page + child RSC) hits the DB once.
 */
export const loadBuilderData = cache(
  (restaurantId: string, menuId: string) =>
    _loadBuilderData(drizzleMenuRead, restaurantId, menuId),
)

export type { BuilderCategory, BuilderItem } from './ui/types'
