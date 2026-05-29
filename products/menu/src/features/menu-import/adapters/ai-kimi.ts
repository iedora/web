/**
 * Kimi (Moonshot) provider adapter for menu-import.
 *
 * Pulls the LanguageModel from `@iedora/ai/kimi` — this file owns
 * only the domain: which model kind (vision), the structured schema,
 * the prompts. Switching vendor = swap the import.
 */
import 'server-only'
import { generateObject } from 'ai'
import { createKimiClient } from '@iedora/ai/kimi'
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
  normalizePatchOperations,
  PATCH_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  USER_PROMPT,
} from './ai-shared'

// 8k tokens fits ~100 items + JSON scaffolding; the model still stops
// naturally on shorter menus. Default openai-compatible cap (~1k) would
// truncate any tasca with five sections.
const MAX_OUTPUT_TOKENS = 8192

export type KimiAdapter = ImageAnalysisPort & {
  /** Test seam: skip the upload fetch, hand raw fixture bytes in. */
  _parseMenuFromBytes(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<ParseMenuResult>
}

export function createKimiAdapter(
  options: { apiKey?: string } = {},
): KimiAdapter {
  const kimi = createKimiClient({ apiKey: options.apiKey })
  const model = kimi.model({ kind: 'vision' })

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
        maxOutputTokens: MAX_OUTPUT_TOKENS,
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
          // Only ship variants when there are any — keeps the prompt
          // shorter for the common single-price case.
          ...(it.variants && it.variants.length > 0
            ? {
                variants: it.variants.map((v) => ({
                  label: v.label,
                  priceCents: v.priceCents,
                })),
              }
            : {}),
        })),
      })),
    }

    try {
      const { object } = await generateObject({
        model,
        schema: MenuPatchSchema,
        system: PATCH_SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
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
        operations: normalizePatchOperations(object.operations),
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
