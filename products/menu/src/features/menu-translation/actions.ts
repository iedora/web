'use server'

import { requireRestaurantBySlug } from '../auth'
import type { LanguageCode } from '../i18n'
import { revalidateRestaurant } from '../menu-publishing'
import { drizzleTranslationData } from './adapters/drizzle'
import { deepseekTranslationAdapter } from './adapters/deepseek'
import {
  refreshTranslations as runRefreshTranslations,
  type RefreshResult,
} from './use-cases/refresh-translations'

/**
 * Smart translation sync for a restaurant. Auth-gated by slug. Only
 * rows whose `translations_synced_at` is older than `updated_at` (or
 * NULL) are sent to DeepSeek, keyed by the operator-picked target languages
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
    deepseekTranslationAdapter,
    {
      restaurantId: r.id,
      targetLanguages: options?.targetLanguages,
    },
  )
  if (result.ok) revalidateRestaurant(slug)
  return result
}
