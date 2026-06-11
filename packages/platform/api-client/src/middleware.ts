/**
 * Auth resolution for the Next middleware (proxy.ts).
 *
 * The middleware is the single place that refreshes expired access
 * tokens for page loads: RSCs cannot mutate cookies, so by refreshing
 * here (and rewriting this request's Cookie header) every server
 * component downstream always sees a valid access cookie.
 */
import type { NextRequest, NextResponse } from 'next/server'

import { refreshTokens } from './auth-api'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookies,
  clearedAuthCookies,
  type CookieWrite,
} from './cookies'
import { sessionFromToken, type Session } from './session'

export type ResolvedAuth = {
  session: Session | null
  /** Cookie writes to stamp on the outgoing response (may be empty). */
  cookieWrites: CookieWrite[]
  /** Replacement request headers when a refresh rewrote the cookies. */
  requestHeaders?: Headers
}

/**
 * Resolves the caller's session, refreshing via the refresh cookie when
 * the access token is missing/expired. A dead refresh token yields
 * cookie deletions so the browser doesn't keep retrying it.
 */
export async function resolveAuth(req: NextRequest): Promise<ResolvedAuth> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  const session = access ? sessionFromToken(access) : null
  if (session) return { session, cookieWrites: [] }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return { session: null, cookieWrites: [] }

  const result = await refreshTokens(refreshToken)
  if (!result) {
    return { session: null, cookieWrites: clearedAuthCookies() }
  }

  const writes = authCookies(result.tokens, result.setCookies)
  return {
    session: sessionFromToken(result.tokens.accessToken),
    cookieWrites: writes,
    requestHeaders: withUpdatedCookies(req, writes),
  }
}

/** Stamps the resolved cookie writes onto the outgoing response. */
export function applyCookies(res: NextResponse, writes: CookieWrite[]): NextResponse {
  for (const c of writes) {
    res.cookies.set(c.name, c.value, c.options)
  }
  return res
}

/** Clones the request headers with the refreshed auth cookie values. */
function withUpdatedCookies(req: NextRequest, writes: CookieWrite[]): Headers {
  const updated = new Map(req.cookies.getAll().map((c) => [c.name, c.value]))
  for (const c of writes) {
    updated.set(c.name, c.value)
  }
  const headers = new Headers(req.headers)
  headers.set(
    'cookie',
    [...updated.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  )
  return headers
}
