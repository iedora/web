/**
 * Kimi (Moonshot) translation adapter — one structured call per target
 * language. We batch every field of a restaurant's stale rows into one
 * request per language: Kimi returns a JSON array of strings in the
 * same order as the input. Sending IDs back-and-forth would let the
 * model return out-of-order, but in practice OpenAI-compatible providers
 * preserve array order, and the JSON-array shape keeps the prompt tiny.
 *
 * If the model fails for a whole language we drop that language's
 * translations silently (the use-case writes whatever did come back;
 * the public menu's `localizedNullable()` falls back to the source).
 */
import 'server-only'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { LanguageCode } from '@/features/i18n'
import type { TranslationPort } from '../ports'

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1'
// `moonshot-v1-32k` is the conservative text-chat model. The newer
// `kimi-k2.6` is faster on paper but its OpenAI-compatible JSON-mode
// behaviour is uneven (returns wrapped objects, drops fields under
// load). 32k context fits a full restaurant's menu strings in one
// batch per language with plenty of headroom.
const KIMI_TEXT_MODEL = 'moonshot-v1-32k'

// Defensive cap. A typical 50-item menu sent in one batch produces ~5k
// output tokens (50 strings × ~80 tokens avg, generously). 8k buys
// headroom for verbose categories without truncating a payload mid-string.
const KIMI_MAX_OUTPUT_TOKENS = 8192

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
}

export function createKimiTranslationAdapter(
  options: { apiKey?: string } = {},
): TranslationPort {
  const apiKey = options.apiKey ?? process.env.KIMI_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    console.warn(
      '[menu-translation/kimi] KIMI_GENERATIVE_AI_API_KEY is missing; translation will fail at call time.',
    )
  }

  const client = createOpenAICompatible({
    name: 'kimi',
    baseURL: KIMI_BASE_URL,
    apiKey: apiKey ?? '',
  })
  const model = client(KIMI_TEXT_MODEL)

  async function translateOneLanguage(
    fromLanguage: LanguageCode,
    toLanguage: LanguageCode,
    texts: string[],
  ): Promise<string[]> {
    const Schema = z.object({
      translations: z
        .array(z.string())
        .describe(
          'Translated strings in the SAME ORDER as the input. One entry per ' +
            'input string. Preserve any units, punctuation, and currency ' +
            'symbols verbatim. Do not add quotes around translations.',
        ),
    })

    const numbered = texts
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n')

    const system = `You are a menu translator.
Translate every line of the input from ${LANGUAGE_LABELS[fromLanguage]} to ${LANGUAGE_LABELS[toLanguage]}.

Rules:
- Return EXACTLY ${texts.length} translations in the same order as the input.
- Preserve the meaning of culinary terms — use the most common name for
  a dish in the target language. For dishes without a target-language
  name (e.g. "Bacalhau à brás" in English), keep the original name
  unchanged.
- Preserve punctuation, capitalisation style, units ("0.5L", "33cl"),
  abbreviations ("p/2 pessoas"), and any printed dietary markers (v),
  (gf).
- Do not add quotes, line numbers, or commentary.
- Do not paraphrase or expand abbreviations.`

    try {
      // The AI SDK auto-selects between tool-calling and JSON mode based
      // on the model's capabilities. `moonshot-v1-*` supports
      // `response_format: { type: 'json_object' }` which the SDK picks
      // up automatically — no explicit mode flag needed.
      const { object } = await generateObject({
        model,
        schema: Schema,
        system,
        temperature: 0,
        maxOutputTokens: KIMI_MAX_OUTPUT_TOKENS,
        prompt: `Translate these ${texts.length} strings:\n\n${numbered}`,
      })
      // Pad or truncate to the expected length so a misbehaving model
      // can't desync downstream indices.
      const result = [...object.translations]
      while (result.length < texts.length) result.push('')
      result.length = texts.length
      return result
    } catch (err) {
      // Bubble the error up — the port layer wraps it into the result
      // shape so the wizard can surface a real message instead of
      // silently writing an empty translation map.
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[menu-translation/kimi] ${fromLanguage}→${toLanguage} call failed`,
        err,
      )
      throw new Error(
        `Translation to ${LANGUAGE_LABELS[toLanguage]} failed: ${message}`,
      )
    }
  }

  return {
    async translate({ fromLanguage, toLanguages, fields }) {
      if (fields.length === 0 || toLanguages.length === 0) return []

      const sourceTexts = fields.map((f) => f.text)
      // One request per target language, in parallel — the model is
      // stateless so we don't gain from a sequential chain. Use
      // `allSettled` so a single failing target doesn't sink the rest;
      // the use-case + action surface the failed languages to the UI.
      const settled = await Promise.allSettled(
        toLanguages.map(async (lang) => ({
          lang,
          texts: await translateOneLanguage(fromLanguage, lang, sourceTexts),
        })),
      )

      const perLanguage: { lang: LanguageCode; texts: string[] }[] = []
      const failed: { lang: LanguageCode; reason: string }[] = []
      for (let i = 0; i < settled.length; i += 1) {
        const outcome = settled[i]!
        const lang = toLanguages[i]!
        if (outcome.status === 'fulfilled') {
          perLanguage.push(outcome.value)
        } else {
          failed.push({
            lang,
            reason:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          })
        }
      }

      // Every successful language gets stamped on the field. Empty
      // strings still drop out so `localizedNullable()` falls back to
      // source.
      const translated = fields.map((field, idx) => {
        const translations: Partial<Record<LanguageCode, string>> = {}
        for (const { lang, texts } of perLanguage) {
          const value = texts[idx]
          if (value && value.trim().length > 0) {
            translations[lang] = value.trim()
          }
        }
        return { ...field, translations }
      })

      if (failed.length > 0) {
        // Attach the failed-language list to the thrown error so the
        // use-case can surface specific copy ("EN failed; ES synced").
        const langs = failed.map((f) => f.lang.toUpperCase()).join(', ')
        const reasons = failed.map((f) => f.reason).join('; ')
        const err = new Error(
          `Translation failed for: ${langs}. ${reasons}`,
        ) as Error & { failedLanguages?: LanguageCode[] }
        err.failedLanguages = failed.map((f) => f.lang)
        // We still throw — the use-case skips the write so we don't
        // bump `translations_synced_at` on a partial sync that would
        // hide the failure from the next click.
        throw err
      }

      return translated
    },
  }
}

export const kimiTranslationAdapter = createKimiTranslationAdapter()
