import 'server-only'
import { z } from 'zod'
import { LANGUAGE_CODES, type LanguageCode } from '@/features/i18n'
import type { IdentityWritePort } from '../ports'

// defaultLanguage MUST be in supportedLanguages so the fallback chain in
// lib/i18n/format.ts always has something to land on.
const Input = z
  .object({
    restaurantId: z.string(),
    defaultLanguage: z.enum(
      LANGUAGE_CODES as unknown as [LanguageCode, ...LanguageCode[]],
    ),
    supportedLanguages: z
      .array(
        z.enum(LANGUAGE_CODES as unknown as [LanguageCode, ...LanguageCode[]]),
      )
      .min(1, 'Pick at least one language'),
  })
  .refine((d) => d.supportedLanguages.includes(d.defaultLanguage), {
    message: 'Default language must be in the supported set',
    path: ['defaultLanguage'],
  })

export type UpdateLanguageSettingsResult =
  | {
      ok: true
      /** Did the default language change vs. the stored value? */
      defaultChanged: boolean
      /** Source columns rewritten by the promotion. */
      rowsPromoted: number
      /** Rows that had no translation to promote — operator must fix. */
      rowsNeedingAttention: number
    }
  | { error: string }

export async function updateLanguageSettings(
  port: IdentityWritePort,
  raw: unknown,
): Promise<UpdateLanguageSettingsResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid language settings',
    }
  }
  // Dedupe + keep declarative order from input. supportedLanguages is a JSON
  // array (not a Postgres set), so we control the persisted shape here.
  const supported = Array.from(new Set(parsed.data.supportedLanguages))
  const stats = await port.updateLanguageSettings(parsed.data.restaurantId, {
    defaultLanguage: parsed.data.defaultLanguage,
    supportedLanguages: supported,
  })
  return { ok: true, ...stats }
}
