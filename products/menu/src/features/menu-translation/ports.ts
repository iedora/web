import type { LanguageCode } from '@/features/i18n'
import type { ItemVariant } from '@/shared/db/schema'

/**
 * A single translatable field on a row. The combination of `{rowKind, id,
 * field}` is the natural key the writer uses to land the result back on
 * the right column.
 *
 * `field` is encoded as one of:
 *   - "name"            — the row's name column
 *   - "description"     — the row's description column
 *   - "variant:<idx>"   — item rows only; the label of the variant at
 *                         the given array index (idx is the variant's
 *                         position in `item.variants` at projection time)
 */
export type TranslatableField = {
  rowKind: 'item' | 'category'
  id: string
  field: string
  text: string
}

/**
 * Output mirrors the input — each input field gets one or more
 * translations keyed by target language. Missing entries (translator
 * declined / errored on a single string) are allowed; callers fall
 * back to the source-language text via `localizedNullable()`.
 */
export type TranslatedField = TranslatableField & {
  translations: Partial<Record<LanguageCode, string>>
}

/**
 * Stateless port for the translation model. Production wires to
 * Kimi via `@ai-sdk/openai-compatible`; tests wire a deterministic fake.
 * The use-case batches multiple fields per call to amortise overhead.
 */
export interface TranslationPort {
  translate(input: {
    fromLanguage: LanguageCode
    toLanguages: LanguageCode[]
    fields: TranslatableField[]
  }): Promise<TranslatedField[]>
}

/**
 * Stale row read off the database. The use-case projects every row
 * needing a refresh into this shape, hands it to the translation port,
 * then writes the results back via `TranslationWritePort`.
 */
export type StaleRow = {
  rowKind: 'item' | 'category'
  id: string
  name: string
  nameI18n: Partial<Record<LanguageCode, string>> | null
  description: string | null
  descriptionI18n: Partial<Record<LanguageCode, string>> | null
  /**
   * Item rows only — the item's variants at the moment of the stale
   * read. Each `label` is a translatable string; the writer rebuilds
   * the array with the translations merged into each variant's
   * `labelI18n`. Categories have no variants — leave undefined.
   */
  variants?: ItemVariant[] | null
}

export type WriteUpdate = {
  rowKind: 'item' | 'category'
  id: string
  nameI18n: Partial<Record<LanguageCode, string>> | null
  descriptionI18n: Partial<Record<LanguageCode, string>> | null
  /**
   * Item rows only — the rebuilt variants array with translated
   * `labelI18n`s merged in. `undefined` means "leave the column alone";
   * pass `null` (or `[]`) to explicitly clear.
   */
  variants?: ItemVariant[] | null
}

export interface TranslationDataPort {
  /**
   * Returns rows in this restaurant whose translations are stale —
   * `translations_synced_at IS NULL OR < updated_at`. Filters out rows
   * whose source `name` is empty (defensive — shouldn't happen).
   */
  findStale(restaurantId: string): Promise<StaleRow[]>

  /**
   * Writes the translated i18n maps back to the rows and stamps
   * `translations_synced_at = now()` in a single transaction.
   */
  applyTranslations(
    restaurantId: string,
    updates: ReadonlyArray<WriteUpdate>,
  ): Promise<void>

  /**
   * Reads the restaurant's language config (default + supported). The
   * use-case derives translation targets from this.
   */
  getRestaurantLanguageConfig(
    restaurantId: string,
  ): Promise<{
    defaultLanguage: LanguageCode
    supportedLanguages: LanguageCode[]
  }>
}
