import { describe, expect, it } from 'vitest'
import { computeSessionStats } from './stats'
import type { SessionRecord } from './ports'

function rec(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now()
  return {
    id: 'sid-1',
    userId: 'u-1',
    email: 'a@b.com',
    name: 'Alice',
    roles: ['iedora-admin'],
    permissions: ['qr-codes:read'],
    permissionsVersion: 1,
    createdAt: new Date(now - 60_000),
    lastSeenAt: new Date(now - 30_000),
    expiresAt: new Date(now + 7 * 24 * 3600_000),
    revokedAt: null,
    revokedReason: null,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132.0',
    ipHash: 'abc',
    ...overrides,
  }
}

describe('computeSessionStats', () => {
  const NOW = new Date('2026-05-21T15:00:00Z')

  it('returns zeros + NaN on an empty list', () => {
    const s = computeSessionStats([], NOW)
    expect(s.total).toBe(0)
    expect(s.uniqueUsers).toBe(0)
    expect(s.last24h).toBe(0)
    expect(s.staleCount).toBe(0)
    expect(Number.isNaN(s.avgAgeHours)).toBe(true)
    expect(s.browsers).toEqual([])
    expect(s.operatingSystems).toEqual([])
    expect(s.permissionVersionMax).toBe(0)
  })

  it('counts unique users (sessions / users yields avg devices/user)', () => {
    const rows = [
      rec({ userId: 'a' }),
      rec({ userId: 'a' }),
      rec({ userId: 'b' }),
    ]
    const s = computeSessionStats(rows, NOW)
    expect(s.total).toBe(3)
    expect(s.uniqueUsers).toBe(2)
  })

  it('marks rows created within 24h as last24h', () => {
    const rows = [
      rec({ createdAt: new Date(NOW.getTime() - 1_000) }), // 1s ago
      rec({ createdAt: new Date(NOW.getTime() - 23 * 3600_000) }), // 23h ago
      rec({ createdAt: new Date(NOW.getTime() - 25 * 3600_000) }), // 25h ago
    ]
    expect(computeSessionStats(rows, NOW).last24h).toBe(2)
  })

  it('marks rows whose lastSeenAt is older than 24h as stale', () => {
    const rows = [
      rec({ lastSeenAt: new Date(NOW.getTime() - 1_000) }), // fresh
      rec({ lastSeenAt: new Date(NOW.getTime() - 23 * 3600_000) }), // fresh
      rec({ lastSeenAt: new Date(NOW.getTime() - 26 * 3600_000) }), // stale
    ]
    expect(computeSessionStats(rows, NOW).staleCount).toBe(1)
  })

  it('computes avgAgeHours from lastSeenAt', () => {
    const rows = [
      rec({ lastSeenAt: new Date(NOW.getTime() - 1 * 3600_000) }), // 1h
      rec({ lastSeenAt: new Date(NOW.getTime() - 3 * 3600_000) }), // 3h
    ]
    expect(computeSessionStats(rows, NOW).avgAgeHours).toBeCloseTo(2, 4)
  })

  it('histograms browsers, ordered by count desc', () => {
    const rows = [
      rec({ userAgent: 'Mozilla/5.0 (Mac) Chrome/132' }),
      rec({ userAgent: 'Mozilla/5.0 (Mac) Chrome/132' }),
      rec({ userAgent: 'Mozilla/5.0 (Mac) Firefox/133' }),
      rec({ userAgent: 'Mozilla/5.0 (Mac) Safari/537' }),
      rec({ userAgent: null }),
    ]
    const s = computeSessionStats(rows, NOW)
    expect(s.browsers).toEqual([
      { name: 'Chrome', count: 2 },
      { name: 'Firefox', count: 1 },
      { name: 'Safari', count: 1 },
      { name: 'Unknown', count: 1 },
    ])
  })

  it('histograms operating systems', () => {
    const rows = [
      rec({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Safari' }),
      rec({ userAgent: 'Mozilla/5.0 (Windows NT 10) Chrome' }),
      rec({ userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X 10_15_7) Chrome' }),
    ]
    const s = computeSessionStats(rows, NOW)
    expect(new Set(s.operatingSystems.map((o) => o.name))).toEqual(
      new Set(['iOS', 'Windows', 'macOS']),
    )
  })

  it('tracks the max permissionsVersion across rows (webhook fan-out hint)', () => {
    const rows = [
      rec({ permissionsVersion: 1 }),
      rec({ permissionsVersion: 3 }),
      rec({ permissionsVersion: 2 }),
    ]
    expect(computeSessionStats(rows, NOW).permissionVersionMax).toBe(3)
  })
})
