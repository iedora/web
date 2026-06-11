import { afterEach, describe, expect, it } from 'vitest'
import {
  BRAND_DOMAIN,
  PRODUCTS,
  productUrl,
  type ProductId,
} from './index'

/**
 * Contract for the cross-product registry. Three invariants matter:
 *
 *   1. `PRODUCTS` keys mirror values (single source of truth for ids).
 *   2. `productUrl(id)` returns the configured env var when present,
 *      falls back to the `<id>.iedora.com` default otherwise.
 *   3. Every entry in `PRODUCTS` resolves through `productUrl` — i.e.
 *      adding an id without a `case` branch in the switch is caught
 *      at test time (the switch is exhaustive at compile time, but
 *      this asserts behaviour too).
 *
 * Pure module: no DB, no Next, no `server-only` — safe to run in the
 * default vitest environment.
 */

const ENV_KEYS = {
  menu: 'NEXT_PUBLIC_MENU_URL',
} as const satisfies Record<ProductId, string>

afterEach(() => {
  for (const key of Object.values(ENV_KEYS)) {
    delete process.env[key]
  }
})

describe('PRODUCTS registry', () => {
  it('PRODUCTS keys mirror values (id is its own key)', () => {
    for (const [key, value] of Object.entries(PRODUCTS)) {
      expect(value).toBe(key)
    }
  })

  it('ProductId union covers every PRODUCTS entry', () => {
    // The type is structural, but the runtime keys should match the
    // declared ProductId members. Touch each id so a future addition
    // requires updating this list.
    const ids: ProductId[] = ['menu']
    expect(new Set(ids)).toEqual(new Set(Object.values(PRODUCTS)))
  })
})

describe('productUrl()', () => {
  it('falls back to https://<id>.iedora.com when env is unset', () => {
    expect(productUrl(PRODUCTS.menu)).toBe(`https://menu.${BRAND_DOMAIN}`)
  })

  it('returns the env var when set', () => {
    process.env.NEXT_PUBLIC_MENU_URL = 'http://localhost:3000/menu'

    expect(productUrl(PRODUCTS.menu)).toBe('http://localhost:3000/menu')
  })

  it('every PRODUCTS entry resolves through productUrl', () => {
    // The switch in productUrl is exhaustive at compile time, but the
    // runtime check guards against an entry where someone added the
    // id but forgot the switch branch (would return undefined).
    for (const id of Object.values(PRODUCTS)) {
      const url = productUrl(id)
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
      expect(url.startsWith('http')).toBe(true)
    }
  })

})
