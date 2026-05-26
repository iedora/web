import { z } from 'zod'
import { LANGUAGE_CODES } from './registry'
import type { LanguageCode, LocalizedText } from './types'

// Server-only i18n helpers shared by every action that persists translatable
// text. Imported as `@/features/i18n/server` rather than re-exported from the
// barrel — keeps the rest of the slice (registry, types, format helpers)
// usable in client components without dragging Zod into the client bundle
// for no reason.

// Translation overrides only carry non-default languages — the row's plain
// `name`/`description` is the source of truth for the default language.
// In Zod 4, `z.record(z.enum([...]), v)` is *exhaustive* — every key must be
// present — so we use a generic record + a `refine` to keep the partial-shape
// semantics while still rejecting unknown language codes from a stale client.
export const localizedSchema = z
  .record(z.string(), z.string().trim().max(1000))
  .refine(
    (obj) =>
      Object.keys(obj).every((k) =>
        (LANGUAGE_CODES as readonly string[]).includes(k),
      ),
    { message: 'Unknown language code' },
  )
  .optional()

// Drop empty strings + return null when nothing to persist. Keeps jsonb
// columns compact — empty `{}` would still round-trip but takes a row's row
// width budget for nothing.
export function pruneLocalized(
  input: LocalizedText | undefined,
): LocalizedText | null {
  if (!input) return null
  const out: LocalizedText = {}
  for (const [code, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      out[code as LanguageCode] = value.trim()
    }
  }
  return Object.keys(out).length === 0 ? null : out
}
