import 'server-only'
import { updateTag } from 'next/cache'

/**
 * The single chokepoint for invalidating any view that reads from the public
 * snapshot or the admin menus snapshot for a given restaurant. AGENTS.md hard
 * rule #12: never `revalidatePath('/r/${slug}')` from a mutation — the tag is
 * what matters.
 */

export function restaurantTag(slug: string): string {
  return `restaurant:${slug}`
}

/**
 * Single invalidation entry-point. Mutation actions (menu/category/item
 * upserts, theme save, identity save, language save, upload) call this with
 * the restaurant slug; the next public render rebuilds the snapshot.
 *
 * Uses `updateTag` (read-your-own-writes) over `revalidateTag`: the admin
 * navigates from a save action straight into the public preview or the
 * dashboard view that re-reads the snapshot — we want the fresh value on
 * that very next request, not the eventually-consistent purge model.
 */
export function revalidateRestaurant(slug: string): void {
  updateTag(restaurantTag(slug))
}
