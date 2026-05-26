import { language as en } from './languages/en'
import { language as pt } from './languages/pt'
import { language as es } from './languages/es'
import { language as fr } from './languages/fr'
import type { Language, LanguageCode, LanguageMeta } from './types'

// Adding a language = create components under lib/i18n/languages/<code>/, then
// import + entry below. Renderer, settings UI and Zod validation pick the new
// entry up automatically. Keep this file short on purpose.
const REGISTRY: Record<LanguageCode, Language> = { en, pt, es, fr }

export function getLanguage(code: string): Language | undefined {
  return REGISTRY[code as LanguageCode]
}

export const LANGUAGES: readonly Language[] = Object.values(REGISTRY)

export const LANGUAGE_META: readonly LanguageMeta[] = LANGUAGES.map((l) => ({
  code: l.code,
  name: l.name,
  nativeName: l.nativeName,
  dir: l.dir,
}))

export const LANGUAGE_CODES: readonly LanguageCode[] = LANGUAGES.map(
  (l) => l.code,
)

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value)
}
