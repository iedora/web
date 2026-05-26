/**
 * Provider-scoped tests for the Kimi adapter. These cover Kimi's
 * specific configuration; cross-provider concerns (schema, mapping,
 * error classification) live in `ai-shared.test.ts`.
 *
 * Adding another provider? Mirror this file for it (`ai-openai.test.ts`,
 * `ai-claude.test.ts`) — each provider owns its own config tests so a
 * model-name typo or a base-URL drift surfaces locally without poking
 * the network.
 */

import { describe, expect, it, vi } from 'vitest'
import { _kimiConfig, createKimiAdapter } from './ai-kimi'

vi.mock('server-only', () => ({}))

describe('Kimi adapter · configuration', () => {
  it('points at Moonshot international (api.moonshot.ai/v1)', () => {
    expect(_kimiConfig.baseURL).toBe('https://api.moonshot.ai/v1')
  })

  it('targets the 32k vision-preview model (text-only models reject image parts)', () => {
    expect(_kimiConfig.model).toBe('moonshot-v1-32k-vision-preview')
  })

  it('budgets 8192 output tokens so full menus fit without truncation', () => {
    expect(_kimiConfig.maxOutputTokens).toBe(8192)
  })
})

describe('Kimi adapter · construction', () => {
  it('builds an adapter that exposes the `ImageAnalysisPort` shape', () => {
    const adapter = createKimiAdapter({ apiKey: 'test-key' })
    expect(typeof adapter.parseMenuFromImage).toBe('function')
  })

  it('still constructs (with a warning) when the API key is missing — the auth error surfaces at call time, not at module load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createKimiAdapter({ apiKey: undefined })
    expect(typeof adapter.parseMenuFromImage).toBe('function')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('KIMI_GENERATIVE_AI_API_KEY is missing'),
    )
    warn.mockRestore()
  })
})
