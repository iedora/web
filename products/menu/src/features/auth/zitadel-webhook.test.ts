import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildPermissionsResponse,
  parseAdminEmails,
  verifyZitadelSignature,
  type WebhookDeps,
} from './zitadel-webhook'
import { IEDORA_ADMIN_ROLE } from './roles'
import { SCOPES } from './scopes'

const KEY = 'k'.repeat(32)

function sign(rawBody: string, ts: number, key = KEY): string {
  const v1 = createHmac('sha256', key).update(`${ts}.${rawBody}`).digest('hex')
  return `t=${ts},v1=${v1}`
}

function noopDeps(): WebhookDeps {
  return {
    adminEmails: new Set(),
    grantIedoraAdmin: vi.fn(async () => false),
  }
}

describe('verifyZitadelSignature', () => {
  it('accepts a valid signature minted with the same key', () => {
    const body = '{"function":"preuserinfo"}'
    const ts = 1_700_000_000
    expect(verifyZitadelSignature(sign(body, ts), body, KEY, ts)).toEqual({ ok: true })
  })

  it('rejects when the signing key differs', () => {
    const body = '{}'
    const ts = 1_700_000_000
    const header = sign(body, ts, 'wrong-key')
    expect(verifyZitadelSignature(header, body, KEY, ts).ok).toBe(false)
  })

  it('rejects when the body has been tampered with', () => {
    const ts = 1_700_000_000
    const header = sign('{"orig":1}', ts)
    expect(verifyZitadelSignature(header, '{"orig":2}', KEY, ts).ok).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyZitadelSignature(null, '{}', KEY, 0)).toEqual({
      ok: false,
      error: 'missing signature',
    })
  })

  it('rejects a malformed header (no t / v1)', () => {
    expect(verifyZitadelSignature('garbage', '{}', KEY, 0).ok).toBe(false)
    expect(verifyZitadelSignature('t=123', '{}', KEY, 123).ok).toBe(false)
    expect(verifyZitadelSignature('v1=deadbeef', '{}', KEY, 0).ok).toBe(false)
  })

  it('rejects a timestamp more than 5 minutes off — bounds the replay window', () => {
    const body = '{}'
    const ts = 1_000_000
    const header = sign(body, ts)
    expect(verifyZitadelSignature(header, body, KEY, ts + 6 * 60).ok).toBe(false)
    expect(verifyZitadelSignature(header, body, KEY, ts - 6 * 60).ok).toBe(false)
    expect(verifyZitadelSignature(header, body, KEY, ts + 4 * 60).ok).toBe(true)
  })

  it('rejects a mis-length sig (hex string with the wrong byte count)', () => {
    const body = '{}'
    const ts = 1_700_000_000
    const v1 = createHmac('sha256', KEY).update(`${ts}.${body}`).digest('hex').slice(0, -2)
    expect(
      verifyZitadelSignature(`t=${ts},v1=${v1}`, body, KEY, ts).ok,
    ).toBe(false)
  })
})

describe('parseAdminEmails', () => {
  it('handles empty / undefined', () => {
    expect(parseAdminEmails(undefined).size).toBe(0)
    expect(parseAdminEmails('').size).toBe(0)
  })
  it('splits + trims + lowercases + drops blanks', () => {
    const s = parseAdminEmails('  Alice@Iedora.com , bob@iedora.com,, ')
    expect(s.has('alice@iedora.com')).toBe(true)
    expect(s.has('bob@iedora.com')).toBe(true)
    expect(s.size).toBe(2)
  })
})

describe('buildPermissionsResponse', () => {
  it('expands iedora-admin (bundle) into every QR scope', async () => {
    const body = JSON.stringify({
      function: 'preuserinfo',
      user_grants: [{ roles: [IEDORA_ADMIN_ROLE] }],
    })
    const res = await buildPermissionsResponse(body, noopDeps())
    expect(res.append_claims[0]?.key).toBe('permissions')
    expect(new Set(res.append_claims[0]?.value as string[])).toEqual(
      new Set([
        SCOPES.QR_CODES_READ,
        SCOPES.QR_CODES_WRITE,
        SCOPES.QR_CODES_UPDATE,
        SCOPES.QR_CODES_DELETE,
      ]),
    )
  })

  it('passes atomic scopes through unchanged + dedupes across grants', async () => {
    const body = JSON.stringify({
      user_grants: [
        { roles: [SCOPES.QR_CODES_UPDATE] },
        { roles: [SCOPES.QR_CODES_UPDATE, SCOPES.QR_CODES_READ] },
      ],
    })
    const res = await buildPermissionsResponse(body, noopDeps())
    const value = res.append_claims[0]?.value as string[]
    expect(new Set(value)).toEqual(
      new Set([SCOPES.QR_CODES_UPDATE, SCOPES.QR_CODES_READ]),
    )
    expect(new Set(value).size).toBe(value.length)
  })

  it('drops unknown role keys without crashing', async () => {
    const body = JSON.stringify({
      user_grants: [{ roles: ['some-unknown-bundle', 'qr-codes:does-not-exist'] }],
    })
    const res = await buildPermissionsResponse(body, noopDeps())
    expect(res.append_claims[0]?.value).toEqual([])
  })

  it('returns empty permissions on malformed body — never throws', async () => {
    const res = await buildPermissionsResponse('not json', noopDeps())
    expect(res.append_claims[0]?.value).toEqual([])
  })

  it('returns empty permissions when user_grants is missing', async () => {
    const res = await buildPermissionsResponse('{}', noopDeps())
    expect(res.append_claims[0]?.value).toEqual([])
  })

  describe('self-heal', () => {
    function adminEvent(email = 'admin@iedora.com') {
      return JSON.stringify({
        function: 'preuserinfo',
        user: { id: 'u1', human: { email } },
        org: { id: 'o1' },
        user_grants: [],
      })
    }

    it('grants iedora-admin inline when email matches and no grant exists', async () => {
      const grantFn = vi.fn(async () => true)
      const deps: WebhookDeps = {
        adminEmails: new Set(['admin@iedora.com']),
        grantIedoraAdmin: grantFn,
      }
      const res = await buildPermissionsResponse(adminEvent(), deps)
      expect(grantFn).toHaveBeenCalledWith('u1', 'o1')
      // Permissions include the bundle's expanded scopes even though
      // the event payload had no grants — proof the inline grant
      // landed in the same response.
      expect(new Set(res.append_claims[0]?.value as string[])).toEqual(
        new Set([
          SCOPES.QR_CODES_READ,
          SCOPES.QR_CODES_WRITE,
          SCOPES.QR_CODES_UPDATE,
          SCOPES.QR_CODES_DELETE,
        ]),
      )
    })

    it('case-insensitive email match (Zitadel may surface mixed case)', async () => {
      const grantFn = vi.fn(async () => true)
      const deps: WebhookDeps = {
        adminEmails: parseAdminEmails('admin@iedora.com'),
        grantIedoraAdmin: grantFn,
      }
      await buildPermissionsResponse(adminEvent('Admin@Iedora.com'), deps)
      expect(grantFn).toHaveBeenCalledTimes(1)
    })

    it('skips inline grant when the user already has iedora-admin', async () => {
      const grantFn = vi.fn(async () => true)
      const deps: WebhookDeps = {
        adminEmails: new Set(['admin@iedora.com']),
        grantIedoraAdmin: grantFn,
      }
      const body = JSON.stringify({
        user: { id: 'u1', human: { email: 'admin@iedora.com' } },
        org: { id: 'o1' },
        user_grants: [{ roles: [IEDORA_ADMIN_ROLE] }],
      })
      await buildPermissionsResponse(body, deps)
      expect(grantFn).not.toHaveBeenCalled()
    })

    it('skips inline grant when the email is NOT in the admin list', async () => {
      const grantFn = vi.fn(async () => true)
      const deps: WebhookDeps = {
        adminEmails: new Set(['someoneelse@iedora.com']),
        grantIedoraAdmin: grantFn,
      }
      const res = await buildPermissionsResponse(adminEvent(), deps)
      expect(grantFn).not.toHaveBeenCalled()
      expect(res.append_claims[0]?.value).toEqual([])
    })

    it('does NOT add iedora-admin to permissions if the inline grant fails', async () => {
      // grantIedoraAdmin returns false (network failure / Zitadel
      // rejected) — we must not pretend the user has the role.
      const deps: WebhookDeps = {
        adminEmails: new Set(['admin@iedora.com']),
        grantIedoraAdmin: vi.fn(async () => false),
      }
      const res = await buildPermissionsResponse(adminEvent(), deps)
      expect(res.append_claims[0]?.value).toEqual([])
    })

    it('skips the grant when userId or orgId is missing from the event', async () => {
      const grantFn = vi.fn(async () => true)
      const deps: WebhookDeps = {
        adminEmails: new Set(['admin@iedora.com']),
        grantIedoraAdmin: grantFn,
      }
      const body = JSON.stringify({
        user: { human: { email: 'admin@iedora.com' } }, // no id
        org: { id: 'o1' },
      })
      await buildPermissionsResponse(body, deps)
      expect(grantFn).not.toHaveBeenCalled()
    })
  })
})
