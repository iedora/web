/**
 * Provider-scoped tests for the DeepSeek adapter. Cross-provider concerns
 * (schema, mapping, error classification) live in `ai-shared.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { _deepseekConfig, createDeepseekAdapter } from './ai-deepseek'

vi.mock('server-only', () => ({}))

describe('DeepSeek adapter · configuration', () => {
  it('points at the DeepSeek API (api.deepseek.com/v1)', () => {
    expect(_deepseekConfig.baseURL).toBe('https://api.deepseek.com/v1')
  })

  it('targets deepseek-v4-flash (native multimodal, 128K context)', () => {
    expect(_deepseekConfig.model).toBe('deepseek-v4-flash')
  })

  it('budgets 8192 output tokens so full menus fit without truncation', () => {
    expect(_deepseekConfig.maxOutputTokens).toBe(8192)
  })
})

describe('DeepSeek adapter · construction', () => {
  it('builds an adapter that exposes the `ImageAnalysisPort` shape', () => {
    const adapter = createDeepseekAdapter({ apiKey: 'test-key' })
    expect(typeof adapter.parseMenuFromImage).toBe('function')
  })

  it('still constructs (with a warning) when the API key is missing — the auth error surfaces at call time, not at module load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createDeepseekAdapter({ apiKey: undefined })
    expect(typeof adapter.parseMenuFromImage).toBe('function')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DEEPSEEK_API_KEY is missing'),
    )
    warn.mockRestore()
  })
})
