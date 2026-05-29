import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  delete process.env.CORE_BASE_URL
  delete process.env.CORE_SECRET
})

describe('auth module — Vercel lazy import pattern', () => {
  // ── Build-time safety (next build must not crash) ──

  it('imports without env vars (next build is safe)', async () => {
    await expect(import('./auth')).resolves.toBeDefined()
  })

  it('auth proxy does not throw at module load', async () => {
    const { auth } = await import('./auth')
    expect(auth).toBeDefined()
  })

  // ── Runtime validation (instrumentation startup reports missing env) ──

  it('getAuth() throws with clear message when env vars missing', async () => {
    const { getAuth } = await import('./auth')
    expect(() => getAuth()).toThrow(
      '[iedora/auth] CORE_BASE_URL and CORE_SECRET must be set.',
    )
  })

  it('auth proxy throws on property access without env vars', async () => {
    const { auth } = await import('./auth')
    expect(() => auth.api).toThrow()
  })
})
