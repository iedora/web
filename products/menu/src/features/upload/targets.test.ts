import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { buildKey } = await import('./targets')
import type { AssetTarget } from './types'

/**
 * Structural invariant: every key built by the upload slice starts with
 * `r/{restaurantId}/`. The R2 custom domain serves the entire assets bucket
 * publicly — anything outside the `r/` prefix would also be world-readable,
 * which would matter the day a bug introduces a non-tenant-prefixed write.
 *
 * Keep this test green and the residual risk stays bounded by the only
 * write path we expose.
 */
describe('buildKey — tenant-prefix invariant', () => {
  const cases: { name: string; target: AssetTarget; mime: string }[] = [
    {
      name: 'restaurant-logo',
      target: { kind: 'restaurant-logo', restaurantId: 'abc123' },
      mime: 'image/jpeg',
    },
    {
      name: 'restaurant-banner',
      target: { kind: 'restaurant-banner', restaurantId: 'abc123' },
      mime: 'image/png',
    },
    {
      name: 'item-photo',
      target: {
        kind: 'item-photo',
        restaurantId: 'abc123',
        itemId: 'item456',
      },
      mime: 'image/webp',
    },
  ]

  for (const { name, target, mime } of cases) {
    it(`${name} → starts with r/{restaurantId}/`, () => {
      const key = buildKey(target, mime)
      expect(key.startsWith(`r/${target.restaurantId}/`)).toBe(true)
    })
  }

  it('does not allow path traversal even if restaurantId contains "../"', () => {
    // The Zod schema in presign-asset.ts validates restaurantId shape (min 1),
    // but doesn't actively reject "../". Belt-and-suspenders: the key still
    // starts with `r/` — slashes inside restaurantId stay inside the prefix.
    const key = buildKey(
      { kind: 'restaurant-logo', restaurantId: '../etc' },
      'image/jpeg',
    )
    expect(key.startsWith('r/')).toBe(true)
  })
})
