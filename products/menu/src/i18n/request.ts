import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { LANGUAGE_CODES, type LanguageCode } from '@/features/i18n'

// next-intl is the *UI strings* layer for the admin dashboard. Content i18n
// (item names, descriptions, etc.) lives in lib/i18n and is unrelated.
// We share the language registry though — adding a language to lib/i18n is
// what unlocks it here, and partial catalogs deep-merge over English so a
// missing key in fr.json transparently falls back to the English string
// instead of leaking the key path into the UI.
export const DASHBOARD_LOCALE_COOKIE = 'NEXT_LOCALE'
const DEFAULT_LOCALE: LanguageCode = 'en'

function isLanguageCode(value: string | undefined): value is LanguageCode {
  return Boolean(value && (LANGUAGE_CODES as readonly string[]).includes(value))
}

// Pick the first registered language found in `Accept-Language`. Browsers send
// tags like "pt-PT,pt;q=0.9,en;q=0.5" — we strip the region (`pt-PT` → `pt`),
// preserve the priority order, and stop at the first match.
function negotiateFromAcceptLanguage(header: string | null): LanguageCode | null {
  if (!header) return null
  // `split` always yields at least one element, so the `[0]!` is safe.
  const tags = header
    .split(',')
    .map((t) => t.split(';')[0]!.trim().toLowerCase().split('-')[0]!)
  for (const tag of tags) {
    if (isLanguageCode(tag)) return tag
  }
  return null
}

type Messages = Record<string, unknown>

// Deep-merge: `partial` overrides `base` for any key it defines; nested
// objects merge recursively. Strings, numbers, booleans, null and arrays
// are atomic — no per-element merging. Catalogs are flat strings + nested
// namespaces of strings, so this is sufficient.
function mergeCatalogs(base: Messages, partial: Messages): Messages {
  const out: Messages = { ...base }
  for (const [key, value] of Object.entries(partial)) {
    const baseVal = base[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      out[key] = mergeCatalogs(baseVal as Messages, value as Messages)
    } else {
      out[key] = value
    }
  }
  return out
}

export default getRequestConfig(async () => {
  // Cookie wins so a user who explicitly picked a language keeps it across
  // sessions even when their browser advertises something else. The header
  // is only used for first-time anonymous visitors with no cookie set yet.
  const store = await cookies()
  const fromCookie = store.get(DASHBOARD_LOCALE_COOKIE)?.value
  let locale: LanguageCode
  if (isLanguageCode(fromCookie)) {
    locale = fromCookie
  } else {
    const h = await headers()
    locale = negotiateFromAcceptLanguage(h.get('accept-language')) ?? DEFAULT_LOCALE
  }

  // Always load English as the base of truth — every key has an English
  // string. Then layer the locale catalog on top. If the locale catalog
  // doesn't exist (or is incomplete), every missing key reads from English.
  const base: Messages = (await import(`./messages/${DEFAULT_LOCALE}.json`)).default
  let messages: Messages = base

  if (locale !== DEFAULT_LOCALE) {
    try {
      const partial: Messages = (await import(`./messages/${locale}.json`)).default
      messages = mergeCatalogs(base, partial)
    } catch {
      // No catalog file at all — keep `messages = base`. The picked locale
      // still flows through to <html lang> so any locale-aware behavior
      // (like RTL via dir) doesn't depend on having a catalog.
    }
  }

  return { locale, messages }
})
