import type { LanguageCode, LocalizedText } from './types'

// Single readable lookup with deterministic fallback chain:
//   requested lang → default lang (always the row's plain text) → empty string.
// `defaultText` is always the source of truth for the restaurant's default
// language — never store the default in the i18n map to avoid drift.
export function localized(
  defaultText: string,
  i18n: LocalizedText | null | undefined,
  requestedLang: LanguageCode,
  defaultLang: LanguageCode,
): string {
  if (requestedLang === defaultLang) return defaultText
  return i18n?.[requestedLang] ?? defaultText
}

// Same, but for nullable description fields — preserves null when nothing to show.
export function localizedNullable(
  defaultText: string | null,
  i18n: LocalizedText | null | undefined,
  requestedLang: LanguageCode,
  defaultLang: LanguageCode,
): string | null {
  if (requestedLang === defaultLang) return defaultText
  return i18n?.[requestedLang] ?? defaultText
}

// Negotiate the best language to render for a visitor:
//   1. explicit `?lang=` if it's in the restaurant's supported set
//   2. the first supported language found in Accept-Language
//   3. defaultLanguage as the last-resort fallback.
export function pickLanguage({
  requested,
  acceptLanguage,
  supported,
  defaultLanguage,
}: {
  requested?: string | null
  acceptLanguage?: string | null
  supported: readonly LanguageCode[]
  defaultLanguage: LanguageCode
}): LanguageCode {
  if (requested && (supported as readonly string[]).includes(requested)) {
    return requested as LanguageCode
  }
  if (acceptLanguage) {
    const tags = acceptLanguage
      .split(',')
      .map((t) => t.split(';')[0].trim().toLowerCase().split('-')[0])
    for (const tag of tags) {
      if ((supported as readonly string[]).includes(tag)) return tag as LanguageCode
    }
  }
  return defaultLanguage
}
