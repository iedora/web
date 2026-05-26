// Adding a language: create lib/i18n/languages/<code>/, export `language` from
// its index.ts, register it in registry.ts, then extend this LanguageCode
// union literal. The compiler enforces registry coverage from there.
export type LanguageCode = 'en' | 'pt' | 'es' | 'fr'

export type LanguageMeta = {
  code: LanguageCode
  // Auto-translated label, e.g. "Portuguese". Used in the dashboard UI.
  name: string
  // What native speakers call it, e.g. "Português". Used in the public switcher.
  nativeName: string
  dir: 'ltr' | 'rtl'
}

export type Language = LanguageMeta

// Wire-format for translatable text. Default language is always read from the
// row's plain `name` / `description` column; this map only carries overrides
// for non-default languages. Missing entries fall back to default.
export type LocalizedText = Partial<Record<LanguageCode, string>>
