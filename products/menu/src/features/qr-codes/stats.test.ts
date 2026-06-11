import { describe, expect, it } from 'vitest'
import { computeQrStats, type QrCodeListRow } from './stats'

function row(overrides: Partial<QrCodeListRow> = {}): QrCodeListRow {
  const now = Date.now()
  return {
    code: 'aaa',
    restaurantId: null,
    label: null,
    createdAt: new Date(now - 60_000).toISOString(),
    boundAt: null,
    restaurant: null,
    ...overrides,
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

describe('computeQrStats', () => {
  const NOW = new Date('2026-05-21T15:00:00Z')

  it('returns zeros on an empty registry', () => {
    expect(computeQrStats([], NOW)).toEqual({
      total: 0,
      bound: 0,
      unbound: 0,
      withLabel: 0,
      created24h: 0,
      boundLast24h: 0,
      topRestaurants: [],
    })
  })

  it('counts bound vs unbound separately', () => {
    const rows = [
      row({ restaurantId: 'r1', restaurant: { id: 'r1', name: 'Sushi', slug: 's' } }),
      row({ restaurantId: 'r1', restaurant: { id: 'r1', name: 'Sushi', slug: 's' } }),
      row({ restaurantId: null }),
    ]
    const s = computeQrStats(rows, NOW)
    expect(s.bound).toBe(2)
    expect(s.unbound).toBe(1)
    expect(s.total).toBe(3)
  })

  it('counts labeled codes — empty / whitespace labels do not count', () => {
    const rows = [
      row({ label: 'Box A' }),
      row({ label: '   ' }),
      row({ label: null }),
    ]
    expect(computeQrStats(rows, NOW).withLabel).toBe(1)
  })

  it('marks codes created in the last 24h', () => {
    const rows = [
      row({ createdAt: iso(NOW.getTime() - 1_000) }),
      row({ createdAt: iso(NOW.getTime() - 23 * 3600_000) }),
      row({ createdAt: iso(NOW.getTime() - 25 * 3600_000) }),
    ]
    expect(computeQrStats(rows, NOW).created24h).toBe(2)
  })

  it('marks codes bound in the last 24h (boundAt within window)', () => {
    const rows = [
      row({ boundAt: iso(NOW.getTime() - 1_000) }),
      row({ boundAt: iso(NOW.getTime() - 25 * 3600_000) }),
      row({ boundAt: null }),
    ]
    expect(computeQrStats(rows, NOW).boundLast24h).toBe(1)
  })

  it('ranks restaurants by bound count, desc, top 5', () => {
    const rows = [
      row({ restaurantId: 'a', restaurant: { id: 'a', name: 'Alpha', slug: 'a' } }),
      row({ restaurantId: 'a', restaurant: { id: 'a', name: 'Alpha', slug: 'a' } }),
      row({ restaurantId: 'a', restaurant: { id: 'a', name: 'Alpha', slug: 'a' } }),
      row({ restaurantId: 'b', restaurant: { id: 'b', name: 'Beta', slug: 'b' } }),
      row({ restaurantId: 'c', restaurant: { id: 'c', name: 'Charlie', slug: 'c' } }),
      row({ restaurantId: 'd', restaurant: { id: 'd', name: 'Delta', slug: 'd' } }),
      row({ restaurantId: 'e', restaurant: { id: 'e', name: 'Echo', slug: 'e' } }),
      row({ restaurantId: 'f', restaurant: { id: 'f', name: 'Foxtrot', slug: 'f' } }),
    ]
    const s = computeQrStats(rows, NOW)
    expect(s.topRestaurants).toEqual([
      { name: 'Alpha', count: 3 },
      { name: 'Beta', count: 1 },
      { name: 'Charlie', count: 1 },
      { name: 'Delta', count: 1 },
      { name: 'Echo', count: 1 },
    ])
  })

  it('falls back to restaurantId when the joined restaurant is null (deleted FK target)', () => {
    const rows = [
      row({ restaurantId: 'ghost-id', restaurant: null }),
    ]
    expect(computeQrStats(rows, NOW).topRestaurants[0]?.name).toBe('ghost-id')
  })
})
