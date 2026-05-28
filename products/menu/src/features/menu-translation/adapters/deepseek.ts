/**
 * DeepSeek translation adapter — one structured call per target language.
 * Mirrors the Kimi adapter shape: the use-case batches every stale row
 * for a restaurant into one request per language; the model returns a
 * JSON array of strings in the same order as the input.
 *
 * `deepseek-v4-flash` is the cheapest multilingual model on the market
 * (~$0.14/M input, $0.28/M output, May 2026), OpenAI-compatible, with
 * 128K context — plenty for any single restaurant batch.
 */
import 'server-only'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { LanguageCode } from '../../i18n'
import type { TranslationPort } from '../ports'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEEPSEEK_TEXT_MODEL = 'deepseek-v4-flash'
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
}

export function createDeepseekTranslationAdapter(
  options: { apiKey?: string } = {},
): TranslationPort {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.warn(
      '[menu-translation/deepseek] DEEPSEEK_API_KEY is missing; translation will fail at call time.',
    )
  }

  const client = createOpenAICompatible({
    name: 'deepseek',
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: apiKey ?? '',
  })
  const model = client(DEEPSEEK_TEXT_MODEL)

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

    const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n')

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
      const { object } = await generateObject({
        model,
        schema: Schema,
        system,
        temperature: 0,
        maxOutputTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
        prompt: `Translate these ${texts.length} strings:\n\n${numbered}`,
      })
      const result = [...object.translations]
      while (result.length < texts.length) result.push('')
      result.length = texts.length
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[menu-translation/deepseek] ${fromLanguage}→${toLanguage} call failed`,
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
        const langs = failed.map((f) => f.lang.toUpperCase()).join(', ')
        const reasons = failed.map((f) => f.reason).join('; ')
        const err = new Error(
          `Translation failed for: ${langs}. ${reasons}`,
        ) as Error & { failedLanguages?: LanguageCode[] }
        err.failedLanguages = failed.map((f) => f.lang)
        throw err
      }

      return translated
    },
  }
}

export const deepseekTranslationAdapter = createDeepseekTranslationAdapter()
