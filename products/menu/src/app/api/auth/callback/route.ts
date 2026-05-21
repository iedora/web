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
import { publicUrl } from '@/shared/url'

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
 *
 * Every URL built here goes through `publicUrl()` (see `@/shared/url`).
 * Caddy fronts Next in prod; the upstream Next bind is
 * `HOSTNAME=0.0.0.0 PORT=3000`, so any URL constructed from `req.url`
 * / `req.nextUrl.origin` / `req.headers.get('host')` carries that
 * bind. Browsers can't follow it (`http://0.0.0.0:3000/...`) and
 * Zitadel rejects token exchanges against it (`invalid_grant:
 * redirect_uri does not correspond`).
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
  const res = NextResponse.redirect(publicUrl('/', { auth: 'failed' }), {
    status: 302,
  })
  res.cookies.delete(OIDC_FLOW_COOKIE)
  return res
}

export async function GET(req: NextRequest): Promise<Response> {
  const flowJwe = req.cookies.get(OIDC_FLOW_COOKIE)?.value
  if (!flowJwe) return failure()

  const flow = await flowCookies.open(flowJwe)
  if (!flow) return failure()

  // openid-client reads code + state off `currentUrl.searchParams`; it
  // only cares about the path + query. The host MUST be the public one
  // we started /authorize from, or Zitadel rejects the token exchange.
  const currentUrl = publicUrl(req.nextUrl.pathname, req.nextUrl.searchParams)

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

  // `flow.next` was validated as a same-origin path by isSameOriginPath
  // when the flow cookie was minted, and again when it was opened. Now
  // `publicUrl()` anchors the absolute Location at env.MENU_PUBLIC_URL.
  const res = NextResponse.redirect(publicUrl(flow.next), { status: 302 })

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
