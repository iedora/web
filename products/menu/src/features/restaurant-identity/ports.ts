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

  /**
   * Rename the public slug. Returns `taken` when the slug is already in
   * use (the DB's unique index is the canonical check; this surfaces
   * the violation as a typed result instead of throwing). Returns
   * `ok` on success.
   *
   * Callers MUST invalidate BOTH the old and new slug tags after a
   * rename — the public snapshot cache is slug-keyed.
   */
  updateSlug(
    restaurantId: string,
    nextSlug: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'taken' }>
}
