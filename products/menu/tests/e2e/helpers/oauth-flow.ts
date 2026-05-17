import { type Page, expect } from '@playwright/test'
import { getTestkitUrl, getUnderlyingTestkitUrl } from './testkit'

/**
 * Drive the real OIDC handshake end-to-end.
 *
 * Two halves:
 *
 *   1. **Sign up via Better Auth's API** (POST `/api/auth/sign-up/email`)
 *      against the testkit shim. The testkit doesn't ship Better Auth UI
 *      pages (no /login or /signup) — those live in genkan proper. The
 *      API path is what genkan's own forms POST to anyway. We capture
 *      the resulting genkan session cookie.
 *
 *   2. **Drive the OAuth code-exchange through the browser**: inject the
 *      genkan cookie into the browser context for the testkit origin, then
 *      navigate menu's "Get started" CTA → /oauth2/authorize → genkan
 *      sees the existing session, skips /login, mints a code → bounces
 *      back to menu's /api/auth/oauth2/callback/genkan → menu sets its
 *      own session cookie → /dashboard → /onboarding.
 *
 * This still exercises EVERY piece of menu's OAuth-client integration
 * (the part we ship); the only thing it doesn't render is genkan's
 * signup form, which is genkan's surface to test.
 *
 * Used by `auth/full-handshake.spec.ts`. Every other spec uses `signInAs`
 * (cookie-injection fast path) because the full round trip adds ~2-3s
 * per test for no extra coverage.
 */
export async function completeOAuthFlow(
  page: Page,
  user: { email: string; name: string; password: string },
): Promise<void> {
  const testkitUrl = getTestkitUrl()

  // 1. Sign up via Better Auth API. The shim proxies /api/auth/* through
  //    to the testkit's Better Auth handler, so this exercises the real
  //    sign-up flow (account creation, password hash, session row, etc.)
  //    just as a form POST would.
  const signupRes = await page.request.post(
    `${testkitUrl}/api/auth/sign-up/email`,
    {
      data: { name: user.name, email: user.email, password: user.password },
      headers: { origin: testkitUrl },
      failOnStatusCode: false,
    },
  )
  expect(
    signupRes.ok(),
    `sign-up failed (${signupRes.status()}): ${await signupRes.text()}`,
  ).toBe(true)

  // Pull the Set-Cookie headers off the response and seed them into the
  // browser context for the testkit origin. The session cookie lets
  // /oauth2/authorize skip the /login form on the next request.
  const setCookies = signupRes
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
  expect(
    setCookies.length,
    'sign-up did not return a session cookie',
  ).toBeGreaterThan(0)

  // Set the cookie for BOTH origins: the shim (127.0.0.1:4444, where the
  // browser starts) AND the underlying testkit (localhost:<random>, where
  // the shim's forwarded redirects land). Browsers scope cookies by host,
  // and "localhost" and "127.0.0.1" are distinct hosts even though they
  // resolve identically — without the second `addCookies` call, the cookie
  // wouldn't accompany the redirect to /api/auth/oauth2/authorize.
  const underlyingUrl = getUnderlyingTestkitUrl()
  for (const sc of setCookies) {
    const head = sc.value.split(';')[0]
    const eq = head.indexOf('=')
    if (eq < 0) continue
    const name = head.slice(0, eq)
    const value = head.slice(eq + 1)
    if (!value) continue // skip delete-cookies (Max-Age=0)
    await page.context().addCookies([
      { name, value, url: `${testkitUrl}/` },
      { name, value, url: `${underlyingUrl}/` },
    ])
  }

  // 2. Drive the browser through the OAuth flow. The "Get started" CTA
  //    triggers authClient.signIn.oauth2({ providerId: 'genkan' }) →
  //    302 → testkit /oauth2/authorize. With the session cookie set above,
  //    Better Auth resolves the user without prompting and issues a code.
  await page.goto('/')
  await page.getByRole('link', { name: /Get started/i }).first().click()

  // Bounces back through /api/auth/oauth2/callback/genkan → menu cookie
  // is set → /dashboard guard sees no orgs → /onboarding.
  await page.waitForURL(/\/onboarding(\?|$)/, { timeout: 15_000 })
}
