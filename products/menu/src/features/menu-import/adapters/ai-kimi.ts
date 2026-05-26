/**
 * Kimi (Moonshot AI) provider adapter for menu-import.
 *
 * Implements `ImageAnalysisPort` against Moonshot's OpenAI-compatible
 * endpoint. Everything cross-provider lives in `ai-shared.ts`; this file
 * only owns Kimi's vendor-specific bits:
 *
 *   - base URL (`https://api.moonshot.ai/v1`)
 *   - API-key env var (`KIMI_GENERATIVE_AI_API_KEY`)
 *   - model name (`moonshot-v1-32k-vision-preview` — the multimodal one)
 *   - max output token budget tuned for Kimi's defaults
 *
 * To add a new provider, copy this file (`ai-openai.ts`, `ai-claude.ts`),
 * swap the four bits above, point `./ai.ts` at the new factory. Nothing
 * else changes — the strategy pattern keeps consumers stable.
 */
import 'server-only'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import type {
  ImageAnalysisPort,
  ParseMenuPatchResult,
  ParseMenuResult,
} from '../ports'
import {
  classifyError,
  fetchImageBytes,
  mapAIResponseToParsedMenu,
  MenuOutputSchema,
  MenuPatchSchema,
  PATCH_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  USER_PROMPT,
} from './ai-shared'

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1'

// Vision support lives on the `*-vision-preview` family. 32k is the
// pragmatic sweet spot: large enough to fit the system prompt, image
// tokens, and a structured response for any reasonably sized menu,
// small enough to stay cheap. `kimi-k2.*` text models would reject the
// image content part outright.
const KIMI_VISION_MODEL = 'moonshot-v1-32k-vision-preview'

// Default cap on OpenAI-compatible providers is ~1k tokens — enough for
// a tiny tasting menu, not for a regular tasca with five sections. 8k
// comfortably fits ~100 items plus the JSON scaffolding; the model still
// stops naturally when the menu is shorter.
const KIMI_MAX_OUTPUT_TOKENS = 8192

/**
 * Kimi adapter, optionally with an internal `parseMenuFromBytes` exposed
 * for tests. The image-fetch step adds nothing the AI test cares about;
 * skipping it lets us hand the model raw bytes from a local fixture
 * without standing up an HTTP server.
 */
export type KimiAdapter = ImageAnalysisPort & {
  /**
   * Internal helper: same flow as `parseMenuFromImage`, minus the upload
   * fetch. Live tests load a fixture from disk and call this directly.
   */
  _parseMenuFromBytes(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<ParseMenuResult>
}

export function createKimiAdapter(
  options: { apiKey?: string } = {},
): KimiAdapter {
  const apiKey = options.apiKey ?? process.env.KIMI_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    // Don't throw at module-init time — the wizard can render the
    // upload step even without the key (e.g. a misconfigured local dev
    // env). The error lands when the operator actually picks a file.
    console.warn(
      '[menu-import/ai-kimi] KIMI_GENERATIVE_AI_API_KEY is missing; AI parsing will fail with an auth error.',
    )
  }

  const kimi = createOpenAICompatible({
    name: 'kimi',
    baseURL: KIMI_BASE_URL,
    apiKey: apiKey ?? '',
  })

  const model = kimi(KIMI_VISION_MODEL)

  async function parseMenuFromBytes(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<ParseMenuResult> {
    try {
      const { object } = await generateObject({
        model,
        schema: MenuOutputSchema,
        system: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: KIMI_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: bytes, mediaType },
              { type: 'text', text: USER_PROMPT },
            ],
          },
        ],
      })

      return mapAIResponseToParsedMenu(object)
    } catch (err) {
      // Log the raw provider error for ops; never surface it to the
      // UI. The wizard maps `code` to a localized message.
      console.error('[menu-import/ai-kimi] provider call failed', err)
      return {
        error: err instanceof Error ? err.message : String(err),
        code: classifyError(err),
      }
    }
  }

  async function parseMenuPatch({
    imageUrl,
    current,
  }: {
    imageUrl: string
    current: Parameters<ImageAnalysisPort['parseMenuPatch']>[0]['current']
  }): Promise<ParseMenuPatchResult> {
    const fetched = await fetchImageBytes(imageUrl)
    if ('error' in fetched) return fetched

    // Compact context. Keep it short — the AI matches by name anyway,
    // so descriptions and i18n overrides would just burn tokens.
    const compact = {
      language: current.language,
      currency: current.currency,
      categories: current.categories.map((c) => ({
        id: c.id,
        name: c.name,
        items: c.items.map((it) => ({
          id: it.id,
          name: it.name,
          priceCents: it.priceCents,
        })),
      })),
    }

    try {
      const { object } = await generateObject({
        model,
        schema: MenuPatchSchema,
        system: PATCH_SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: KIMI_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: fetched.bytes, mediaType: fetched.mediaType },
              {
                type: 'text',
                text:
                  'Current menu (JSON):\n```json\n' +
                  JSON.stringify(compact) +
                  '\n```\n\nReturn only the operations needed to bring this in line with the photo.',
              },
            ],
          },
        ],
      })
      return {
        language: object.language,
        currency: object.currency,
        operations: object.operations,
      }
    } catch (err) {
      console.error('[menu-import/ai-kimi] PATCH call failed', err)
      return {
        error: err instanceof Error ? err.message : String(err),
        code: classifyError(err),
      }
    }
  }

  return {
    async parseMenuFromImage(imageUrl: string): Promise<ParseMenuResult> {
      const fetched = await fetchImageBytes(imageUrl)
      if ('error' in fetched) return fetched
      return parseMenuFromBytes(fetched.bytes, fetched.mediaType)
    },
    parseMenuPatch,
    _parseMenuFromBytes: parseMenuFromBytes,
  }
}

/**
 * Configuration constants exposed for the per-provider test file. Kept
 * out of the shared module — these are Kimi's, not every provider's.
 */
export const _kimiConfig = {
  baseURL: KIMI_BASE_URL,
  model: KIMI_VISION_MODEL,
  maxOutputTokens: KIMI_MAX_OUTPUT_TOKENS,
} as const
