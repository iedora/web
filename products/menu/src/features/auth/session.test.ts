import { describe, expect, it, vi } from 'vitest'
import { makeSessionCookie, makeOidcFlowAdapter, isSameOriginPath } from './adapters/session'

vi.mock('server-only', () => ({}))

const SECRET = 'a'.repeat(48)

describe('session cookie — opaque pointer round-trip', () => {
  it('seals + opens a pointer', async () => {
    const a = makeSessionCookie(SECRET)
    const pointer = {
      sid: 'opaque-session-id',
      sub: 'u1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const jwe = await a.seal(pointer)
    expect(jwe).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(await a.open(jwe)).toEqual(pointer)
  })

  it('rejects a cookie sealed with a different secret (rotation invalidates sessions)', async () => {
    const oldAdapter = makeSessionCookie(SECRET)
    const newAdapter = makeSessionCookie('b'.repeat(48))
    const jwe = await oldAdapter.seal({
      sid: 's',
      sub: 'u',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    expect(await newAdapter.open(jwe)).toBeNull()
  })

  it('returns null on tampered ciphertext (AES-GCM detects the bit-flip)', async () => {
    const a = makeSessionCookie(SECRET)
    const jwe = await a.seal({
      sid: 's',
      sub: 'u',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const parts = jwe.split('.')
    if (!parts[3]) throw new Error('unexpected JWE shape')
    parts[3] = parts[3].startsWith('A') ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1)
    expect(await a.open(parts.join('.'))).toBeNull()
  })

  it('returns null on expired payloads (exp in the past)', async () => {
    const a = makeSessionCookie(SECRET)
    const past = Math.floor(Date.now() / 1000) - 60
    const jwe = await a.seal({ sid: 's', sub: 'u', exp: past })
    expect(await a.open(jwe)).toBeNull()
  })

  it('rejects legacy pre-#21 cookies that lack a `sid` claim (fail-closed cutover)', async () => {
    // Simulate a self-contained cookie from the old shape — same secret,
    // no `sid`. Decryption succeeds; the missing claim makes us return null.
    const { EncryptJWT } = await import('jose')
    const { createHash } = await import('node:crypto')
    const key = new Uint8Array(createHash('sha256').update(SECRET).digest())
    const legacyJwe = await new EncryptJWT({
      sub: 'u1',
      email: 'u@x',
      name: 'U',
      roles: ['iedora-admin'],
      permissions: [],
    })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .encrypt(key)

    const a = makeSessionCookie(SECRET)
    expect(await a.open(legacyJwe)).toBeNull()
  })
})

describe('OIDC flow cookie', () => {
  it('round-trips the {state, codeVerifier, next} envelope', async () => {
    const flow = makeOidcFlowAdapter(SECRET)
    const payload = { state: 'st1', codeVerifier: 'cv1', next: '/dashboard' }
    const jwe = await flow.seal(payload)
    expect(await flow.open(jwe)).toEqual(payload)
  })

  it('rejects payloads whose `next` field is an off-origin URL', async () => {
    const flow = makeOidcFlowAdapter(SECRET)
    // Bypass `seal`'s implicit validation by hand-crafting the path.
    // The open path re-validates same-origin, so the cookie reads null.
    const jwe = await flow.seal({
      state: 'st',
      codeVerifier: 'cv',
      next: 'https://evil.example/steal',
    })
    expect(await flow.open(jwe)).toBeNull()
  })
})

describe('isSameOriginPath', () => {
  it.each([
    ['/dashboard', true],
    ['/dashboard/r/sushi', true],
    ['', false],
    ['//evil', false],
    ['/\\evil', false],
    ['https://evil.example/steal', false],
    ['javascript:alert(1)', false],
    ['../escape', false],
  ])('matches %s → %s', (input, expected) => {
    expect(isSameOriginPath(input)).toBe(expected)
  })
})
