/**
 * DeepSeek (V4) provider adapter for menu-import.
 *
 * Implements `ImageAnalysisPort` against DeepSeek's OpenAI-compatible
 * endpoint. Vendor-specific bits:
 *
 *   - base URL (`https://api.deepseek.com/v1`)
 *   - API-key env var (`DEEPSEEK_API_KEY`)
 *   - model name (`deepseek-v4-flash` — native multimodal, 128K context)
 *   - max output token budget
 *
 * V4 Flash encodes images with ~90 KV-cache entries (vs Claude's ~870),
 * which is why it lands at ~$0.14/M input despite being multimodal.
 * Everything cross-provider stays in `ai-shared.ts`.
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

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash'
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192

export type DeepseekAdapter = ImageAnalysisPort & {
  _parseMenuFromBytes(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<ParseMenuResult>
}

export function createDeepseekAdapter(
  options: { apiKey?: string } = {},
): DeepseekAdapter {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.warn(
      '[menu-import/ai-deepseek] DEEPSEEK_API_KEY is missing; AI parsing will fail with an auth error.',
    )
  }

  const deepseek = createOpenAICompatible({
    name: 'deepseek',
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: apiKey ?? '',
  })

  const model = deepseek(DEEPSEEK_VISION_MODEL)

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
        maxOutputTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
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
      console.error('[menu-import/ai-deepseek] provider call failed', err)
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
        maxOutputTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
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
      console.error('[menu-import/ai-deepseek] PATCH call failed', err)
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

export const _deepseekConfig = {
  baseURL: DEEPSEEK_BASE_URL,
  model: DEEPSEEK_VISION_MODEL,
  maxOutputTokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
} as const
