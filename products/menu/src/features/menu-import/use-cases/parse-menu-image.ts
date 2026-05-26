import 'server-only'
import { z } from 'zod'
import { LANGUAGE_CODES } from '@/features/i18n'
import type { LanguageCode } from '@/features/i18n'
import type { ImageAnalysisPort, ParseMenuResult } from '../ports'

const ParsedItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  /**
   * Price in integer cents. AGENTS.md hard rule #6 — money is always cents.
   * The AI is prompted to return floats (e.g. 12.50 → 1250); we round
   * defensively here.
   */
  priceCents: z.number().int().min(0).max(100_000_00).default(0),
  available: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(1),
})

const ParsedCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(ParsedItemSchema).min(0),
})

const ParseMenuOutputSchema = z.object({
  /**
   * Defensive language clamp: anything outside our supported set falls back
   * to 'en'. The AI shouldn't violate the schema (it's a closed enum at the
   * adapter layer) but coerce here so a stale registry entry never crashes
   * the import.
   */
  language: z
    .string()
    .transform((value): LanguageCode =>
      (LANGUAGE_CODES as readonly string[]).includes(value)
        ? (value as LanguageCode)
        : 'en',
    ),
  currency: z.string().trim().max(8).default(''),
  categories: z.array(ParsedCategorySchema).min(0),
})

/**
 * Calls the AI vision port and validates the structured output with Zod.
 *
 * Returns the parsed menu on success, `{ error }` when the AI cannot
 * extract anything useful or when the response doesn't pass validation.
 * Never throws.
 */
export async function parseMenuImage(
  port: ImageAnalysisPort,
  input: { imageUrl: string },
): Promise<ParseMenuResult> {
  const raw = await port.parseMenuFromImage(input.imageUrl)

  if ('error' in raw) return raw

  const validated = ParseMenuOutputSchema.safeParse(raw)
  if (!validated.success) {
    return {
      error: `AI returned an unexpected shape: ${validated.error.issues[0]?.message ?? 'unknown'}`,
      code: 'parse',
    }
  }

  if (validated.data.categories.length === 0) {
    return {
      error:
        'No menu items could be extracted. Try a clearer photo with better lighting.',
      code: 'parse',
    }
  }

  return {
    language: validated.data.language,
    currency: validated.data.currency,
    categories: validated.data.categories,
  }
}
