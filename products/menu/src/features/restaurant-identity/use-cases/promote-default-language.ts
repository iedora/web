import 'server-only'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import type { ItemVariant } from '@/shared/db/schema'

/**
 * Source-of-truth FLIP helpers used when an operator changes the
 * restaurant's `defaultLanguage`.
 *
 * Why we need this:
 *
 *   Translatable rows store the default-language value in plain text
 *   columns (`name` / `description` / variant.label) and translations
 *   into other languages in sibling `*I18n` jsonb maps. When the operator
 *   switches the default from PT → EN, the row's `name` still holds the
 *   PT text but the renderer will treat it as the EN source — wrong.
 *
 *   This file ROTATES the slots:
 *     1. Promote: `i18n[newDefault]` → source column.
 *     2. Demote:  the OLD source value → `i18n[oldDefault]` slot.
 *
 *   Rows that have no `i18n[newDefault]` value can't be promoted —
 *   they're flagged as "needs attention" so the operator knows where to
 *   re-translate manually.
 *
 * Everything in here is pure (no DB, no React) — the adapter calls it
 * per-row inside a single transaction.
 */

export type FieldPromotion = {
  source: string
  i18n: LocalizedText | null
  promoted: boolean
  needsAttention: boolean
}

export type NullableFieldPromotion = {
  source: string | null
  i18n: LocalizedText | null
  promoted: boolean
  needsAttention: boolean
}

/**
 * Promote a required field (name / variant label).
 *
 *   - If `oldDefault === newDefault`, no-op.
 *   - If `i18n[newDefault]` is present + non-empty, swap:
 *       source ← i18n[newDefault]
 *       i18n[oldDefault] ← old source (when non-empty)
 *       i18n[newDefault] removed (now the source)
 *   - If no translation exists, leave source as the OLD-default value
 *     and flag `needsAttention` so the caller can warn the operator.
 */
export function promoteField(
  sourceText: string,
  i18n: LocalizedText | null | undefined,
  oldDefault: LanguageCode,
  newDefault: LanguageCode,
): FieldPromotion {
  if (oldDefault === newDefault) {
    return {
      source: sourceText,
      i18n: i18n ?? null,
      promoted: false,
      needsAttention: false,
    }
  }
  const incoming = i18n?.[newDefault] ?? ''
  if (incoming.length === 0) {
    // Nothing to promote — operator will see old-language text in the
    // new-default slot until they retranslate. Flag if there was actual
    // content (empty rows aren't a UX problem).
    return {
      source: sourceText,
      i18n: i18n ?? null,
      promoted: false,
      needsAttention: sourceText.length > 0,
    }
  }
  const next: LocalizedText = { ...(i18n ?? {}) }
  delete next[newDefault]
  if (sourceText.length > 0) {
    next[oldDefault] = sourceText
  }
  return {
    source: incoming,
    i18n: Object.keys(next).length === 0 ? null : next,
    promoted: true,
    needsAttention: false,
  }
}

/**
 * Promote a nullable field (description). Same logic, with null pass-
 * through. A row that had no description doesn't "need attention" — it
 * simply had nothing to translate.
 */
export function promoteNullableField(
  sourceText: string | null,
  i18n: LocalizedText | null | undefined,
  oldDefault: LanguageCode,
  newDefault: LanguageCode,
): NullableFieldPromotion {
  const res = promoteField(sourceText ?? '', i18n, oldDefault, newDefault)
  const nextSource = res.source.length === 0 ? null : res.source
  return {
    source: nextSource,
    i18n: res.i18n,
    promoted: res.promoted,
    // For nullable fields, an empty source after the rotation isn't
    // "needs attention" — it just means the row never had a value to
    // translate in any language.
    needsAttention:
      res.needsAttention && (sourceText ?? '').length > 0,
  }
}

export type VariantsPromotion = {
  variants: ItemVariant[]
  promoted: number
  needsAttention: number
}

/**
 * Promote every variant on an item in one go. Returns the rewritten
 * variants array plus per-variant counters so the caller can aggregate
 * "rows touched" across the whole restaurant.
 */
export function promoteVariants(
  variants: ReadonlyArray<ItemVariant> | null | undefined,
  oldDefault: LanguageCode,
  newDefault: LanguageCode,
): VariantsPromotion {
  if (!variants || variants.length === 0) {
    return { variants: [], promoted: 0, needsAttention: 0 }
  }
  let promoted = 0
  let needsAttention = 0
  const next = variants.map((v) => {
    const res = promoteField(v.label, v.labelI18n ?? null, oldDefault, newDefault)
    if (res.promoted) promoted += 1
    if (res.needsAttention) needsAttention += 1
    return {
      label: res.source,
      labelI18n: res.i18n,
      priceCents: v.priceCents,
    }
  })
  return { variants: next, promoted, needsAttention }
}
