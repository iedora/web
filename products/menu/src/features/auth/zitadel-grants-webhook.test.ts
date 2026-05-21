import { describe, expect, it, vi } from 'vitest'
import {
  handleGrantEvent,
  isRemovalEvent,
  parseGrantEvent,
  type GrantsLookup,
} from './zitadel-grants-webhook'
import { IEDORA_ADMIN_ROLE } from './roles'
import { SCOPES } from './scopes'

function event(overrides: Record<string, unknown> = {}, type = 'user.grant.added') {
  return JSON.stringify({
    event_type: type,
    aggregateID: 'grant-1',
    event_payload: {
      userId: 'u-1',
      // `projectId` deliberately omitted — Zitadel's `user.grant.changed`
      // wire shape only includes diff fields, so the parser must not
      // require it (we filter on iedoraProjectId via the lookup instead).
      roleKeys: [IEDORA_ADMIN_ROLE],
      ...overrides,
    },
  })
}

describe('parseGrantEvent', () => {
  it('extracts subjectUserId + roleKeys', () => {
    const r = parseGrantEvent(event())
    expect(r).toEqual({
      subjectUserId: 'u-1',
      payloadRoleKeys: [IEDORA_ADMIN_ROLE],
      eventType: 'user.grant.added',
    })
  })

  it('returns null on malformed JSON', () => {
    expect(parseGrantEvent('not json')).toBeNull()
  })

  it('returns null when event_type is not user.grant.*', () => {
    expect(parseGrantEvent(event({}, 'org.added'))).toBeNull()
  })

  it('returns null when userId is missing (deactivated/reactivated events)', () => {
    expect(parseGrantEvent(event({ userId: undefined }))).toBeNull()
  })

  it('parses even when projectId is absent (changed events ship diff fields only)', () => {
    const r = parseGrantEvent(
      JSON.stringify({
        event_type: 'user.grant.changed',
        event_payload: { userId: 'u-1', roleKeys: ['qr-codes:read'] },
      }),
    )
    expect(r?.subjectUserId).toBe('u-1')
  })

  it('coerces roleKeys to [] when absent (removal events)', () => {
    const r = parseGrantEvent(event({ roleKeys: undefined }, 'user.grant.removed'))
    expect(r?.payloadRoleKeys).toEqual([])
  })

  it('drops non-string entries from roleKeys', () => {
    const r = parseGrantEvent(
      event({ roleKeys: [IEDORA_ADMIN_ROLE, 42, null, 'qr-codes:read'] }),
    )
    expect(r?.payloadRoleKeys).toEqual([IEDORA_ADMIN_ROLE, 'qr-codes:read'])
  })
})

describe('isRemovalEvent', () => {
  it.each([
    ['user.grant.removed', true],
    ['user.grant.cascade.removed', true],
    ['user.grant.deactivated', true],
    ['user.grant.added', false],
    ['user.grant.changed', false],
    ['user.grant.cascade.changed', false],
    ['user.grant.reactivated', false],
  ])('%s → %s', (type, expected) => {
    expect(isRemovalEvent(type)).toBe(expected)
  })
})

describe('handleGrantEvent', () => {
  function deps(overrides: Partial<Parameters<typeof handleGrantEvent>[1]> = {}) {
    return {
      iedoraProjectId: 'p-iedora',
      lookupGrants: vi.fn(async () => [IEDORA_ADMIN_ROLE]) as GrantsLookup,
      refreshSessionsForUser: vi.fn(async () => 1),
      ...overrides,
    }
  }

  it('looks up grants + refreshes sessions on added event', async () => {
    const d = deps()
    const res = await handleGrantEvent(event(), d)
    expect(d.lookupGrants).toHaveBeenCalledWith('u-1', 'p-iedora')
    expect(d.refreshSessionsForUser).toHaveBeenCalledWith('u-1', {
      roles: [IEDORA_ADMIN_ROLE],
      permissions: expect.arrayContaining([SCOPES.QR_CODES_READ]),
    })
    expect(res).toMatchObject({ ok: true, userId: 'u-1', touched: 1 })
  })

  it('skips lookup + sends empty permission set on removed event', async () => {
    const lookup = vi.fn() as GrantsLookup
    const refresh = vi.fn(async () => 2)
    const res = await handleGrantEvent(
      event({}, 'user.grant.removed'),
      deps({ lookupGrants: lookup, refreshSessionsForUser: refresh }),
    )
    expect(lookup).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledWith('u-1', { roles: [], permissions: [] })
    expect(res).toMatchObject({ ok: true, userId: 'u-1', touched: 2 })
  })

  it('skips when iedoraProjectId is empty (build-time stub)', async () => {
    const refresh = vi.fn(async () => 0)
    const res = await handleGrantEvent(
      event(),
      deps({ iedoraProjectId: '', refreshSessionsForUser: refresh }),
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(res).toMatchObject({ ok: true, skipped: 'no_iedora_project_id' })
  })

  it('returns parse_failed on malformed body — never throws', async () => {
    const res = await handleGrantEvent('not json', deps())
    expect(res).toMatchObject({ ok: true, skipped: 'parse_failed' })
  })

  it('surfaces an error when the grant lookup throws', async () => {
    const d = deps({
      lookupGrants: vi.fn(async () => {
        throw new Error('zitadel down')
      }) as GrantsLookup,
    })
    const res = await handleGrantEvent(event(), d)
    expect(res).toEqual({ ok: false, error: 'zitadel down' })
  })

  it('surfaces an error when the session refresh throws', async () => {
    const d = deps({
      refreshSessionsForUser: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    const res = await handleGrantEvent(event(), d)
    expect(res).toEqual({ ok: false, error: 'db down' })
  })
})
