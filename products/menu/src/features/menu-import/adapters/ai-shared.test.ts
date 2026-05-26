/**
 * Cross-provider tests for the menu-import AI flow. Every concrete
 * provider (Kimi today, OpenAI / Claude later) leans on these helpers,
 * so a regression here would surface across all of them.
 *
 * Per-provider quirks (model name, base URL, request shaping) get their
 * own tests in the matching `ai-<provider>.test.ts` file.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  classifyError,
  mapAIResponseToParsedMenu,
  MenuOutputSchema,
} from './ai-shared'

vi.mock('server-only', () => ({}))

// ── Schema resilience ──────────────────────────────────────────────────────

describe('AI schema · item field defaults', () => {
  it('accepts a fully-specified item unchanged', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Entradas',
          items: [
            {
              name: 'Azeitonas',
              description: 'casa',
              priceCents: 200,
              confidence: 0.95,
            },
          ],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]).toEqual({
      name: 'Azeitonas',
      description: 'casa',
      priceCents: 200,
      confidence: 0.95,
    })
  })

  it("fills missing `confidence` with 1 (providers drop it on items they're certain about)", () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Entradas',
          items: [{ name: 'Pão com manteiga', priceCents: 250 }],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]?.confidence).toBe(1)
  })

  it('fills missing `priceCents` with 0 (providers sometimes omit it for unpriced items)', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Sobremesas',
          items: [{ name: 'Fruta da época' }],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]?.priceCents).toBe(0)
  })

  it('allows `description` to stay undefined when not present on the menu', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Bebidas',
          items: [{ name: 'Água', priceCents: 100 }],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]?.description).toBeUndefined()
  })

  it("still rejects items with no `name` — the one field we can't derive", () => {
    const result = MenuOutputSchema.safeParse({
      language: 'pt',
      currency: 'EUR',
      categories: [{ name: 'Entradas', items: [{ priceCents: 200 }] }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts an item with one or more variants', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Pratos principais',
          items: [
            {
              name: 'Bacalhau à brás',
              priceCents: 1450,
              variants: [{ label: 'Meia dose', priceCents: 800 }],
            },
          ],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]?.variants).toEqual([
      { label: 'Meia dose', priceCents: 800 },
    ])
  })

  it('lets the AI omit `variants` entirely on single-price items', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Bebidas',
          items: [{ name: 'Café (Bica)', priceCents: 100 }],
        },
      ],
    })
    expect(parsed.categories[0]?.items[0]?.variants).toBeUndefined()
  })
})

describe('AI schema · top-level defaults', () => {
  it('fills missing `currency` with an empty string (no symbol on the menu)', () => {
    const parsed = MenuOutputSchema.parse({
      language: 'en',
      categories: [
        { name: 'Coffee', items: [{ name: 'Espresso', priceCents: 150 }] },
      ],
    })
    expect(parsed.currency).toBe('')
  })

  it('rejects unknown language codes (closed enum)', () => {
    const result = MenuOutputSchema.safeParse({
      language: 'de',
      currency: 'EUR',
      categories: [],
    })
    expect(result.success).toBe(false)
  })

  it('fills missing `categories` with an empty array', () => {
    const parsed = MenuOutputSchema.parse({ language: 'en' })
    expect(parsed.categories).toEqual([])
  })
})

// ── Response mapping ───────────────────────────────────────────────────────

describe('AI response → ParsedMenu', () => {
  it('stamps `available: true` on every item regardless of price', () => {
    const mapped = mapAIResponseToParsedMenu({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Snacks',
          items: [
            // €0 stays available — a free item, not unavailable.
            { name: 'Pão da casa', priceCents: 0, confidence: 1 },
            { name: 'Azeitonas', priceCents: 200, confidence: 1 },
          ],
        },
      ],
    })
    expect(mapped.categories[0]?.items.every((item) => item.available)).toBe(true)
  })

  it('preserves description, price, and confidence', () => {
    const mapped = mapAIResponseToParsedMenu({
      language: 'en',
      currency: 'EUR',
      categories: [
        {
          name: 'Mains',
          items: [
            {
              name: 'Bacalhau à brás',
              description: 'salt cod, eggs, potato straws',
              priceCents: 1450,
              confidence: 0.6,
            },
          ],
        },
      ],
    })
    const item = mapped.categories[0]?.items[0]
    expect(item?.name).toBe('Bacalhau à brás')
    expect(item?.description).toBe('salt cod, eggs, potato straws')
    expect(item?.priceCents).toBe(1450)
    expect(item?.confidence).toBe(0.6)
    expect(item?.available).toBe(true)
  })

  it('round-trips an empty-categories response (model says "not a menu")', () => {
    const mapped = mapAIResponseToParsedMenu({
      language: 'en',
      currency: '',
      categories: [],
    })
    expect(mapped.categories).toEqual([])
    expect(mapped.language).toBe('en')
    expect(mapped.currency).toBe('')
  })

  it('forwards variants when the AI provided them', () => {
    const mapped = mapAIResponseToParsedMenu({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Mains',
          items: [
            {
              name: 'Bacalhau à brás',
              priceCents: 1450,
              confidence: 1,
              variants: [{ label: 'Meia dose', priceCents: 800 }],
            },
          ],
        },
      ],
    })
    expect(mapped.categories[0]?.items[0]?.variants).toEqual([
      { label: 'Meia dose', priceCents: 800 },
    ])
  })

  it('drops the `variants` property entirely when the AI returned none', () => {
    const mapped = mapAIResponseToParsedMenu({
      language: 'pt',
      currency: 'EUR',
      categories: [
        {
          name: 'Bebidas',
          items: [{ name: 'Café (Bica)', priceCents: 100, confidence: 1 }],
        },
      ],
    })
    expect(
      Object.prototype.hasOwnProperty.call(
        mapped.categories[0]?.items[0] ?? {},
        'variants',
      ),
    ).toBe(false)
  })
})

// ── Error classification ───────────────────────────────────────────────────

describe('Error classification', () => {
  it('treats billing / quota / rate-limit signals as `quota`', () => {
    expect(
      classifyError(new Error('Your prepayment credits are depleted')),
    ).toBe('quota')
    expect(classifyError(new Error('quota exceeded'))).toBe('quota')
    expect(classifyError(new Error('rate limit hit'))).toBe('quota')
    expect(classifyError(new Error('HTTP 429 Too Many Requests'))).toBe('quota')
  })

  it('treats key / permission signals as `auth`', () => {
    expect(classifyError(new Error('Invalid API key'))).toBe('auth')
    expect(classifyError(new Error('401 Unauthorized'))).toBe('auth')
    expect(classifyError(new Error('403 Forbidden'))).toBe('auth')
  })

  it('treats transport problems as `network`', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('network')
    expect(classifyError(new Error('ECONNRESET'))).toBe('network')
    expect(classifyError(new Error('Request timeout'))).toBe('network')
  })

  it('treats truncated-JSON signatures as `truncated` (model hit maxOutputTokens)', () => {
    expect(
      classifyError(new Error('Unterminated string in JSON at position 3149')),
    ).toBe('truncated')
    expect(classifyError(new Error('Unexpected end of JSON input'))).toBe(
      'truncated',
    )
  })

  it('treats schema / parse mismatches as `parse`', () => {
    expect(
      classifyError(new Error('schema validation failed for `confidence`')),
    ).toBe('parse')
    expect(classifyError(new Error('Invalid response from model'))).toBe(
      'parse',
    )
  })

  it('falls back to `unknown` for unfamiliar errors', () => {
    expect(classifyError(new Error('something went sideways'))).toBe('unknown')
    expect(classifyError('a string, not an Error')).toBe('unknown')
  })
})
