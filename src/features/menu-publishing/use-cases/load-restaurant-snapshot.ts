import 'server-only'
import { eq } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/shared/db/client'
import { restaurant, type RestaurantTheme } from '@/shared/db/schema'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { loadMenuTree, type RawMenu } from './load-tree'
import { restaurantTag } from '../cache'

/**
 * The public menu page is read-heavy and changes only when the admin edits
 * something. Caching the snapshot per restaurant lets the page serve from
 * memory until the next mutation, instead of hitting the DB on every scan.
 *
 * Why a function and not `unstable_cache(...)` at module scope:
 *   `unstable_cache` takes `tags` as a static array at definition time, so we
 *   can't bake `restaurant:${slug}` into a single-shared closure. Wrapping
 *   per-call gives us per-slug tags while still hitting the same backend
 *   cache entry (the entry is keyed off `keyParts`, which includes slug).
 *
 * Why a snapshot vs. full localized page output:
 *   Language picking depends on the visitor's `accept-language` header and
 *   `?lang=` param — both Request-time inputs. Caching the raw row + tree
 *   keeps the cache key down to `slug`; the page then localizes in memory.
 *   The localization step is a pure JSON walk and doesn't need its own cache.
 *
 * `revalidate: false` → entries live until `revalidateRestaurant(slug)` is
 * called. Stripe-style background refresh isn't useful here; a menu only
 * changes when the admin saves.
 */

export type RestaurantSnapshot = {
  id: string
  organizationId: string
  name: string
  slug: string
  description: string | null
  descriptionI18n: LocalizedText | null
  logoUrl: string | null
  bannerUrl: string | null
  theme: RestaurantTheme | null
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  /** Active-only menu tree. The public page never needs disabled menus. */
  tree: RawMenu[]
}

export async function loadRestaurantSnapshot(
  slug: string,
): Promise<RestaurantSnapshot | null> {
  return unstable_cache(
    async (s: string): Promise<RestaurantSnapshot | null> => {
      const rows = await db
        .select({
          id: restaurant.id,
          organizationId: restaurant.organizationId,
          name: restaurant.name,
          slug: restaurant.slug,
          description: restaurant.description,
          descriptionI18n: restaurant.descriptionI18n,
          logoUrl: restaurant.logoUrl,
          bannerUrl: restaurant.bannerUrl,
          theme: restaurant.theme,
          defaultLanguage: restaurant.defaultLanguage,
          supportedLanguages: restaurant.supportedLanguages,
        })
        .from(restaurant)
        .where(eq(restaurant.slug, s))
        .limit(1)
      const r = rows[0]
      if (!r) return null

      const tree = await loadMenuTree({ restaurantId: r.id, activeOnly: true })

      return {
        id: r.id,
        organizationId: r.organizationId,
        name: r.name,
        slug: r.slug,
        description: r.description,
        descriptionI18n: r.descriptionI18n as LocalizedText | null,
        logoUrl: r.logoUrl,
        bannerUrl: r.bannerUrl,
        theme: r.theme as RestaurantTheme | null,
        defaultLanguage: r.defaultLanguage as LanguageCode,
        supportedLanguages: r.supportedLanguages as LanguageCode[],
        tree,
      }
    },
    [`restaurant-snapshot:${slug}`],
    { tags: [restaurantTag(slug)], revalidate: false },
  )(slug)
}
