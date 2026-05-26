/**
 * Live end-to-end test of the Kimi adapter against the real Moonshot
 * API. Off by default — runs only when `KIMI_GENERATIVE_AI_API_KEY` is
 * present in the environment. Costs Kimi credits per execution, so don't
 * wire it into CI without thinking through the bill.
 *
 *   bun run test:ai-live      # exposes the env, runs this file
 *
 * The fixture lives in `tests/fixtures/ai/menu-taberna-do-jose.png` —
 * the same Taberna do José menu we hand-debugged earlier (dual price
 * columns in the mains section, mixed text density across categories).
 * If the adapter handles this one cleanly, it'll handle most Portuguese
 * tasca menus.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createKimiAdapter } from './ai-kimi'

vi.mock('server-only', () => ({}))

const HAS_KEY = Boolean(process.env.KIMI_GENERATIVE_AI_API_KEY)
const FIXTURE = join(
  process.cwd(),
  'tests/fixtures/ai/menu-taberna-do-jose.png',
)

const describeLive = HAS_KEY ? describe : describe.skip

describeLive('Kimi adapter · live · Taberna do José', () => {
  it(
    'extracts a four-section Portuguese menu with EUR prices and no phantom categories',
    async () => {
      const bytes = new Uint8Array(await readFile(FIXTURE))
      const adapter = createKimiAdapter()
      const result = await adapter._parseMenuFromBytes(bytes, 'image/png')

      if ('error' in result) {
        throw new Error(`Live call failed: ${result.error} (code=${result.code})`)
      }

      // Language + currency detection.
      expect(result.language).toBe('pt')
      expect(result.currency).toBe('EUR')

      // The real menu has four sections: Entradas, Pratos principais,
      // Sobremesas, Bebidas. Any extra category (e.g. a phantom
      // "PREÇO / DOSE" from the dual-price column) is a regression.
      const categoryNames = result.categories.map((c) => c.name.toLowerCase())
      expect(result.categories.length).toBe(4)
      expect(categoryNames.some((n) => n.includes('entrada'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('prato'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('sobremesa'))).toBe(true)
      expect(categoryNames.some((n) => n.includes('bebida'))).toBe(true)

      // No category should reference the dual-price column header.
      expect(categoryNames.some((n) => n.includes('dose'))).toBe(false)
      expect(categoryNames.some((n) => n.includes('preço'))).toBe(false)

      // Spot-check anchor items the menu definitely contains. Prompt
      // says "leftmost price for priceCents", so Bacalhau à brás is
      // €14,50 (full dose), not €8,00 (half dose).
      const allItems = result.categories.flatMap((c) => c.items)
      const bacalhau = allItems.find((i) =>
        i.name.toLowerCase().includes('bacalhau'),
      )
      expect(bacalhau?.priceCents).toBe(1450)
      // Half-dose price now lands in the variants array, not the
      // description. Tolerate either label spelling — "meia dose" /
      // "1/2 dose" / "½ dose" all map to the same concept.
      expect(bacalhau?.variants?.length).toBe(1)
      const meiaDose = bacalhau?.variants?.[0]
      expect(meiaDose?.priceCents).toBe(800)
      expect(meiaDose?.label?.toLowerCase()).toMatch(/meia|1\/?2|½/)

      const cafe = allItems.find((i) =>
        i.name.toLowerCase().includes('café'),
      )
      expect(cafe?.priceCents).toBe(100)
      // Café (Bica) has just one price — no variants.
      expect(cafe?.variants ?? []).toEqual([])
    },
    // Generous timeout: Kimi vision calls can take 20-40s on cold paths.
    90_000,
  )
})

if (!HAS_KEY) {
  // Help future-us understand why this file looks like a no-op when
  // we glance at the test output.
  console.info(
    '[ai-kimi.live] skipped — set KIMI_GENERATIVE_AI_API_KEY to run.',
  )
}
