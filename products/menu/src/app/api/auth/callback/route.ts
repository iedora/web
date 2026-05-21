import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeAuthorizationCode } from '@/features/auth/adapters/oidc'
import {
  makeOidcFlowAdapter,
  makeSessionCookie,
  OIDC_FLOW_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/features/auth/adapters/session'
import { sessionStore } from '@/features/sessions'
import { env } from '@/shared/env'

/**
 * `GET /api/auth/callback?code=…&state=…`
 *
 * Zitadel-side callback. Reads the flow cookie minted by /api/auth/login,
 * exchanges the authorization code for tokens, persists the menu session
 * cookie, and redirects to the original `next` path.
 *
 * On any failure (missing/bad flow cookie, state mismatch, exchange
 * error) we clear the flow cookie and bounce to `/?auth=failed` so the
 * landing page can render a friendly message. We deliberately do NOT
 * surface the raw OIDC error to the user.
 */
const flowCookies = makeOidcFlowAdapter(env.MENU_SESSION_SECRET)
const sessions = makeSessionCookie(env.MENU_SESSION_SECRET)

/**
 * Extract the client IP from common proxy headers. Caddy sits in front
 * in prod and sets `X-Forwarded-For`; the dev server gets `127.0.0.1` via
 * `req.ip` (Next 16). The value is immediately SHA-256'd before being
 * persisted — we want the audit signal ("same IP across two sessions")
 * without holding raw PII at rest.
 */
function ipHashFromRequest(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const raw = xff?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null
  if (!raw) return null
  return createHash('sha256').update(raw).digest('hex')
}

function failure(): NextResponse {
  // Use the canonical MENU_PUBLIC_URL — NOT `req.nextUrl.origin`.
  // Behind Caddy, Next sees its own internal bind (HOSTNAME=0.0.0.0
  // PORT=3000 from the runner stage of products/menu/Dockerfile),
  // and req.nextUrl.origin reconstructs as `http://0.0.0.0:3000` —
  // a URL the browser can't follow. Same pattern as the login +
  // logout routes already use.
  const url = new URL('/', env.MENU_PUBLIC_URL)
  url.searchParams.set('auth', 'failed')
  const res = NextResponse.redirect(url, { status: 302 })
  res.cookies.delete(OIDC_FLOW_COOKIE)
  return res
}

export async function GET(req: NextRequest): Promise<Response> {
  const flowJwe = req.cookies.get(OIDC_FLOW_COOKIE)?.value
  if (!flowJwe) return failure()

  const flow = await flowCookies.open(flowJwe)
  if (!flow) return failure()

  // Rebuild currentUrl from MENU_PUBLIC_URL + the actual path/query.
  // The naive `new URL(req.url)` would carry `http://0.0.0.0:3000/...`
  // (Next's own internal bind), which openid-client then sends as the
  // `redirect_uri` in the token exchange — Zitadel rejects with
  // `invalid_grant: redirect_uri does not correspond` because the
  // registered URI is the public one. The path + query are what the
  // OIDC library cares about (code + state); the host MUST be the same
  // one /authorize was started from.
  const currentUrl = new URL(
    `${req.nextUrl.pathname}?${req.nextUrl.searchParams.toString()}`,
    env.MENU_PUBLIC_URL,
  )

  let result
  try {
    result = await exchangeAuthorizationCode({
      currentUrl,
      codeVerifier: flow.codeVerifier,
      expectedState: flow.state,
    })
  } catch (err) {
    console.error('[auth/callback] code exchange failed', err)
    return failure()
  }

  const expiresAtSec = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  // Server-side row first — if the insert fails we don't want a cookie
  // pointing at a non-existent sid. Permissions + roles live here so the
  // Zitadel webhook can refresh them without re-auth and the admin UI
  // can revoke without waiting for the cookie to expire.
  const sid = await sessionStore.issue({
    userId: result.sub,
    email: result.email,
    name: result.name,
    roles: result.roles,
    permissions: result.permissions,
    expiresAt: new Date(expiresAtSec * 1000),
    userAgent: req.headers.get('user-agent'),
    ipHash: ipHashFromRequest(req),
  })

  const sessionJwe = await sessions.seal({
    sid,
    sub: result.sub,
    exp: expiresAtSec,
  })

  // Same fix as failure() — use the canonical public URL, not the
  // request's reconstructed origin.
  const nextUrl = new URL(flow.next, env.MENU_PUBLIC_URL)
  const res = NextResponse.redirect(nextUrl, { status: 302 })

  res.cookies.set(SESSION_COOKIE, sessionJwe, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  // Flow cookie is single-use — drop it.
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: '/api/auth' })

  return res
}
