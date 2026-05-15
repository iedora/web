import type { RestaurantTheme } from '@/shared/db/schema'
import type { LanguageCode, LocalizedText } from '@/features/i18n'

/**
 * IdentityWritePort — mutations on the restaurant row's branding +
 * configuration columns.
 *
 * Authorization happens upstream in the action shell (AGENTS.md hard rule
 * #1); the port assumes the caller has already verified ownership of
 * `restaurantId`. Logo/banner files themselves are written by
 * `@/features/upload` — this port only touches the *record* columns.
 */
export interface IdentityWritePort {
  updateTheme(restaurantId: string, theme: RestaurantTheme): Promise<void>

  updateLanguageSettings(
    restaurantId: string,
    fields: {
      defaultLanguage: LanguageCode
      supportedLanguages: LanguageCode[]
    },
  ): Promise<void>

  updateIdentity(
    restaurantId: string,
    fields: {
      name: string
      description: string | null
      descriptionI18n: LocalizedText | null
    },
  ): Promise<void>
}
