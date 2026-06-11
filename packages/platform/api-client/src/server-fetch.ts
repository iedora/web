import { cookies } from 'next/headers'

import { refreshTokens } from './auth-api'
import { ACCESS_COOKIE, REFRESH_COOKIE, authCookies, type CookieWrite } from './cookies'
import { MENU_URL } from './config'
import { ApiError } from './error'

/**
 * Fetch against the Go menu API with the caller's Bearer token.
 *
 * `path` is service-relative (e.g. `/api/restaurants`); absolute URLs
 * pass through for other services. On a 401 with a live refresh cookie
 * it refreshes once, persists the new cookies (only possible in server
 * actions / route handlers — RSC reads are covered by the middleware
 * refresh), and retries.
 */
export async function serverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${MENU_URL}${path}`
  const store = await cookies()

  const doFetch = (token: string | undefined) =>
    fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

  let token = store.get(ACCESS_COOKIE)?.value
  let res = await doFetch(token)

  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      token = refreshed
      res = await doFetch(token)
    }
  }
  return res
}

/** serverFetch + JSON decode, throwing ApiError on non-2xx. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await serverFetch(path, init)
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      message = body.error ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Refreshes the access token and persists both cookies, returning the
 * new access token — or null when there is nothing to refresh with.
 * Cookie writes throw outside server actions / route handlers; in RSCs
 * the middleware owns refresh, so a 401 there falls through to the
 * caller (typically a redirect to sign-in).
 */
async function tryRefresh(): Promise<string | null> {
  const store = await cookies()
  const refreshToken = store.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null
  const result = await refreshTokens(refreshToken)
  if (!result) return null
  try {
    for (const c of authCookies(result.tokens, result.setCookies)) {
      writeCookie(store, c)
    }
  } catch {
    // RSC context: cookies are read-only here. The new token is still
    // good for THIS request's retry; middleware persists on the next.
  }
  return result.tokens.accessToken
}

function writeCookie(store: Awaited<ReturnType<typeof cookies>>, c: CookieWrite): void {
  store.set(c.name, c.value, c.options)
}
