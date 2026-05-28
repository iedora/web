/**
 * Live end-to-end test of the DeepSeek adapter against the real API.
 * Off by default — runs only when `DEEPSEEK_API_KEY` is present in the
 * environment. Costs DeepSeek credits per execution.
 *
 *   bun run test:ai-live      # exposes the env, runs this file
 *
 * Fixture: tests/fixtures/ai/menu-taberna-do-jose.png — same Taberna
 * menu used for the Kimi live test (dual price columns, mixed density).
 */

import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDeepseekAdapter } from './ai-deepseek'

vi.mock('server-only', () => ({}))

const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY)
const FIXTURE = join(
  process.cwd(),
  'tests/fixtures/ai/menu-taberna-do-jose.png',
)

const describeLive = HAS_KEY ? describe : describe.skip

describeLive('DeepSeek adapter · live · Taberna do José', () => {
  it(
    'extracts a four-section Portuguese menu with EUR prices and no phantom categories',
    async () => {
      const bytes = new Uint8Array(await readFile(FIXTURE))
      const adapter = createDeepseekAdapter()
      const result = await adapter._parseMenuFromBytes(bytes, 'image/png')

      if ('error' in result) {
        throw new Error(`Live call failed: ${result.error} (code=${result.code})`)
      }

      expect(result.language).toBe('pt')
      expect(result.currency).toBe('EUR')

      const categoryNames = result.categories.map((c) => c.name.toLowerCase())
      expect(result.categories.length).toBe(4)
      expect(categoryNames.some((n) => n.includes('entrada'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('prato'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('sobremesa'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('bebida'))).toBe(true)

      expect(categoryNames.some((n) => n.includes('dose'))).toBe(false)
      expect(categoryNames.some((n) => n.includes('preço'))).toBe(false)

      const allItems = result.categories.flatMap((c) => c.items)
      const bacalhau = allItems.find((i) =>
        i.name.toLowerCase().includes('bacalhau'),
      )
      expect(bacalhau?.priceCents).toBe(1450)
      expect(bacalhau?.variants?.length).toBe(1)
      const meiaDose = bacalhau?.variants?.[0]
      expect(meiaDose?.priceCents).toBe(800)
      expect(meiaDose?.label?.toLowerCase()).toMatch(/meia|1\/?2|½/)

      const cafe = allItems.find((i) =>
        i.name.toLowerCase().includes('café'),
      )
      expect(cafe?.priceCents).toBe(100)
      expect(cafe?.variants ?? []).toEqual([])
    },
    90_000,
  )
})

if (!HAS_KEY) {
  console.info(
    '[ai-deepseek.live] skipped — set DEEPSEEK_API_KEY to run.',
  )
}
