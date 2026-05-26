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

  /**
   * Updates the restaurant's language config. When `defaultLanguage`
   * changes vs. the current row, ALSO rotates every translatable row
   * inside the restaurant (restaurant.description, category.name +
   * description, item.name + description, item.variants[].label) so
   * the NEW default value sits in the source column and the OLD source
   * value gets demoted to `i18n[oldDefault]`. Atomic — wrap in a
   * transaction.
   *
   * Returns counters so the action shell can log them and surface a
   * "X rows need attention" warning when promotion couldn't fill the
   * new-default slot (no translation existed yet).
   */
  updateLanguageSettings(
    restaurantId: string,
    fields: {
      defaultLanguage: LanguageCode
      supportedLanguages: LanguageCode[]
    },
  ): Promise<{
    /** Default changed? `false` = no promotion was needed. */
    defaultChanged: boolean
    /** Source-column writes performed across all translatable rows. */
    rowsPromoted: number
    /** Rows that had no translation to promote — operator must fix. */
    rowsNeedingAttention: number
  }>

  updateIdentity(
    restaurantId: string,
    fields: {
      name: string
      description: string | null
      descriptionI18n: LocalizedText | null
    },
  ): Promise<void>
}
