import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestGenkan, type TestGenkanHandle } from '@iedora/auth-testkit'

/**
 * Extract a `cookie` request-header from a Set-Cookie-bearing response.
 *
 * Better Auth's impersonate response includes BOTH delete-cookies
 * (`Max-Age=0`, empty value) AND the new session — they appear in order
 * "clear old, set new" on the same names. Naively joining all of them
 * produces a `Cookie:` header like `session_token=; ... session_token=NEW`
 * which Better Auth's parser reads as empty (first wins).
 *
 * Treat the Set-Cookie list as a sequential set of mutations: build a
 * `name → value` map walking left-to-right; later writes override earlier
 * ones; empty values (deletes) drop the entry. Then emit `name=value`
 * pairs as a single `Cookie:` header.
 */
function cookieHeaderFrom(res: Response): string {
  const arr = res.headers.getSetCookie?.() ?? []
  const jar = new Map<string, string>()
  for (const raw of arr) {
    const head = raw.split(';')[0]?.trim()
    if (!head) continue
    const eq = head.indexOf('=')
    if (eq < 0) continue
    const name = head.slice(0, eq)
    const value = head.slice(eq + 1)
    if (value === '') {
      jar.delete(name) // Max-Age=0 entries clear the cookie
    } else {
      jar.set(name, value)
    }
  }
  return Array.from(jar, ([n, v]) => `${n}=${v}`).join('; ')
}

/**
 * Integration test for the impersonation flow shipped in 8847d29.
 *
 * Boots a real Better Auth instance against PGLite (via the auth-testkit)
 * so we exercise the actual admin-plugin endpoints — not a fake gateway.
 * Mirrors the lifecycle the production server actions drive:
 *
 *   1. Sign in as admin              → session A (no impersonatedBy).
 *   2. impersonateUser(targetId)     → session B (cookie = target,
 *                                      `impersonatedBy = admin.id`).
 *   3. stopImpersonating()           → session C (back to admin).
 *
 * The audit-row writes themselves live in genkan's server actions
 * (`impersonateAction`, `stopImpersonatingAction`), which depend on
 * next/headers + redirect and aren't reachable from a vitest. What this
 * test pins is the LOAD-BEARING CLAIM the actions rely on:
 *
 *   - During impersonation, `session.session.impersonatedBy === admin.id`
 *     is reachable to the action so it can record the audit row with the
 *     admin as actor.
 *   - After stopImpersonating, the session is the admin's again — so the
 *     redirect lands the admin back in /admin/users with their privilege.
 *
 * If Better Auth ever changes the impersonate-user contract so
 * `impersonatedBy` is unreachable during the impersonation window OR
 * stopImpersonating doesn't restore the admin's session, this test fails
 * before production audit rows silently flip to the wrong user.
 */

let handle: TestGenkanHandle

const PWD = 'correct-horse-battery-staple-1234'

beforeAll(async () => {
  handle = await startTestGenkan({ clients: [] })
})

afterAll(async () => {
  await handle.stop()
})

describe('Better Auth impersonation flow', () => {
  it('captures impersonatedBy=admin during impersonation, restores admin session on stop', async () => {
    const admin = await handle.seed.user({
      name: 'Admin',
      email: 'admin@example.com',
      password: PWD,
      role: 'admin',
    })
    const target = await handle.seed.user({
      name: 'Target',
      email: 'target@example.com',
      password: PWD,
    })

    // 1. Sign in as admin. Better Auth returns Set-Cookie headers we have
    //    to replay on subsequent calls to act as the same session.
    const signInRes = await handle.auth.api.signInEmail({
      body: { email: admin.email, password: PWD },
      asResponse: true,
    })
    const adminCookies = cookieHeaderFrom(signInRes)
    expect(adminCookies).toBeTruthy()
    const adminHeaders = new Headers({ cookie: adminCookies })

    // Sanity-check: this is the admin's session, no impersonation yet.
    const preSession = await handle.auth.api.getSession({ headers: adminHeaders })
    expect(preSession?.user.id).toBe(admin.id)
    expect(preSession?.session.impersonatedBy).toBeFalsy()

    // 2. Impersonate the target. The plugin rewrites the cookie to point at
    //    the target user and stores `impersonatedBy = admin.id` on the new
    //    session row.
    const impRes = await handle.auth.api.impersonateUser({
      headers: adminHeaders,
      body: { userId: target.id },
      asResponse: true,
    })
    const impCookies = cookieHeaderFrom(impRes)
    expect(impCookies).toBeTruthy()
    const impHeaders = new Headers({ cookie: impCookies })

    const impSession = await handle.auth.api.getSession({ headers: impHeaders })
    expect(impSession?.user.id).toBe(target.id) // cookie is target's now
    expect(impSession?.session.impersonatedBy).toBe(admin.id) // <-- the claim

    // 3. Stop impersonating. Cookie flips back to admin.
    const stopRes = await handle.auth.api.stopImpersonating({
      headers: impHeaders,
      asResponse: true,
    })
    const stopCookies = cookieHeaderFrom(stopRes)
    expect(stopCookies).toBeTruthy()
    const postHeaders = new Headers({ cookie: stopCookies })

    const postSession = await handle.auth.api.getSession({ headers: postHeaders })
    expect(postSession?.user.id).toBe(admin.id)
    expect(postSession?.session.impersonatedBy).toBeFalsy()
  })

  it('rejects stopImpersonating when the caller is not impersonating', async () => {
    const u = await handle.seed.user({
      name: 'Regular',
      email: 'regular@example.com',
      password: PWD,
    })
    const signInRes = await handle.auth.api.signInEmail({
      body: { email: u.email, password: PWD },
      asResponse: true,
    })
    const cookies = cookieHeaderFrom(signInRes)
    const headers = new Headers({ cookie: cookies })

    // With `asResponse: true`, Better Auth surfaces error states as a
    // non-2xx Response instead of throwing — preserves the wire shape.
    // Without that flag the API throws an APIError; we use asResponse for
    // ergonomic assertion + parity with the impersonate steps above.
    const res = await handle.auth.api.stopImpersonating({
      headers,
      asResponse: true,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { message?: string }
    expect(body.message).toMatch(/not impersonating/i)
  })
})
