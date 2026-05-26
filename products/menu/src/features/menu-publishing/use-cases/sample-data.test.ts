import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_MENU } from './sample-data'

vi.mock('server-only', () => ({}))

/**
 * Locks in the sample-data shape that demos the menu features. When new
 * restaurants tap "Sample menu", the seeded content has to surface
 * everything the template can render — including at least one variant
 * row so operators see the pattern out of the gate.
 */
describe('SAMPLE_MENU', () => {
  it('includes at least one item with variants so the public template shows the pattern', () => {
    const itemsWithVariants = SAMPLE_MENU.flatMap((c) =>
      c.items.filter((it) => it.variants && it.variants.length > 0),
    )
    expect(itemsWithVariants.length).toBeGreaterThan(0)
  })

  it("Steak frites carries a 'Meia dose' variant (Portuguese tasca pattern)", () => {
    const steak = SAMPLE_MENU.flatMap((c) => c.items).find(
      (it) => it.name.en === 'Steak frites',
    )
    expect(steak?.variants).toEqual([
      { label: 'Meia dose', priceCents: 1100 },
    ])
  })

  it('keeps the majority of items single-priced (single-price is still the common case)', () => {
    const totalItems = SAMPLE_MENU.reduce((n, c) => n + c.items.length, 0)
    const withVariants = SAMPLE_MENU.flatMap((c) =>
      c.items.filter((it) => it.variants && it.variants.length > 0),
    ).length
    // At least 5x more single-priced than variant-bearing — keeps the
    // sample feel "normal menu with one Portuguese flourish".
    expect(withVariants * 5).toBeLessThanOrEqual(totalItems)
  })
})
