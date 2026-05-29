/**
 * Live extraction snapshot for `tests/fixtures/ai/menu-taberna-do-jose.png`.
 *
 * Skipped unless `MOONSHOT_API_KEY` is set. When it runs, it:
 *
 *   1. Drives the production Kimi adapter against the fixture and
 *      writes the full parsed tree to
 *      `tests/fixtures/ai/menu-taberna-do-jose.extracted.json` so the
 *      operator can open the file and see exactly what came out
 *      (categories, items, variants — including the half-dose / sizes
 *      that the dual-price column produces).
 *
 *   2. Prints a one-screen ASCII rendering of the same tree to stdout
 *      so the result is visible without leaving the terminal.
 *
 * No tight assertions on category counts or prices live here — those
 * stay in `ai-kimi.live.test.ts` (the regression net). This file is the
 * "show me what the model returned" debugging hook.
 *
 *   bun run --cwd products/menu test:ai-live -- taberna-extraction
 */

import { describe, expect, it, vi } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createKimiAdapter } from './ai-kimi'

vi.mock('server-only', () => ({}))

const HAS_KEY = Boolean(process.env.MOONSHOT_API_KEY)
const FIXTURE = join(
  process.cwd(),
  'tests/fixtures/ai/menu-taberna-do-jose.png',
)
const SNAPSHOT = join(
  process.cwd(),
  'tests/fixtures/ai/menu-taberna-do-jose.extracted.json',
)

const describeLive = HAS_KEY ? describe : describe.skip

function euro(cents: number) {
  return `€${(cents / 100).toFixed(2).replace('.', ',')}`
}

describeLive('Kimi extraction snapshot · Taberna do José', () => {
  it(
    'parses the menu and writes the full tree (with variants) to disk',
    async () => {
      const bytes = new Uint8Array(await readFile(FIXTURE))
      const adapter = createKimiAdapter()
      const result = await adapter._parseMenuFromBytes(bytes, 'image/png')

      if ('error' in result) {
        throw new Error(`Live call failed: ${result.error} (code=${result.code})`)
      }

      // ── 1. Snapshot to disk for inspection ────────────────────────────
      await mkdir(dirname(SNAPSHOT), { recursive: true })
      await writeFile(SNAPSHOT, JSON.stringify(result, null, 2), 'utf8')

      // ── 2. ASCII tree to stdout ───────────────────────────────────────
      const lines: string[] = []
      lines.push('')
      lines.push(
        `language=${result.language} · currency=${result.currency} · ${result.categories.length} categories`,
      )
      lines.push('─'.repeat(60))
      for (const cat of result.categories) {
        lines.push(`▼ ${cat.name}  (${cat.items.length} items)`)
        for (const it of cat.items) {
          const conf = (it.confidence ?? 1).toFixed(2)
          const flag = it.confidence < 0.7 ? ' ⚠ ' : '   '
          lines.push(
            `  ${flag}${it.name}  —  ${euro(it.priceCents)}  [conf ${conf}]`,
          )
          if (it.description) {
            lines.push(`        ${it.description}`)
          }
          for (const v of it.variants ?? []) {
            lines.push(`        ↳ ${v.label}: ${euro(v.priceCents)}`)
          }
        }
      }
      lines.push('─'.repeat(60))
      lines.push(`Wrote snapshot → ${SNAPSHOT}`)
      lines.push('')
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'))

      // ── 3. Loose sanity checks — proves the model returned a usable
      //      tree. Tight invariants (4 sections, anchor prices) live in
      //      ai-kimi.live.test.ts.
      expect(result.categories.length).toBeGreaterThan(0)
      const totalItems = result.categories.reduce(
        (n, c) => n + c.items.length,
        0,
      )
      expect(totalItems).toBeGreaterThan(5)

      // Confirm at least one item picked up a variant (this menu has
      // the dual PRECO/DOSE + 1/2 DOSE column on the mains section).
      const hasAnyVariant = result.categories.some((c) =>
        c.items.some((it) => (it.variants ?? []).length > 0),
      )
      expect(hasAnyVariant).toBe(true)
    },
    180_000,
  )
})

if (!HAS_KEY) {
  // eslint-disable-next-line no-console
  console.info(
    '[taberna-extraction.live] skipped — set MOONSHOT_API_KEY to run.',
  )
}
