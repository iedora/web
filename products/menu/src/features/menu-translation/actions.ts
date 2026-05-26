'use server'

import { requireRestaurantBySlug } from '@/features/auth'
import type { LanguageCode } from '@/features/i18n'
import { revalidateRestaurant } from '@/features/menu-publishing'
import { drizzleTranslationData } from './adapters/drizzle'
import { kimiTranslationAdapter } from './adapters/kimi'
import {
  refreshTranslations as runRefreshTranslations,
  type RefreshResult,
} from './use-cases/refresh-translations'

/**
 * Smart translation sync for a restaurant. Auth-gated by slug. Only
 * rows whose `translations_synced_at` is older than `updated_at` (or
 * NULL) are sent to Kimi, keyed by the operator-picked target languages
 * (or the restaurant's `supportedLanguages` minus `defaultLanguage`
 * when no picks are passed).
 *
 * Revalidates the restaurant cache tag on success so the public menu
 * picks up new languages on the next visit.
 */
export async function refreshTranslationsAction(
  slug: string,
  options?: { targetLanguages?: LanguageCode[] },
): Promise<RefreshResult> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const result = await runRefreshTranslations(
    drizzleTranslationData,
    kimiTranslationAdapter,
    {
      restaurantId: r.id,
      targetLanguages: options?.targetLanguages,
    },
  )
  if (result.ok) revalidateRestaurant(slug)
  return result
}
