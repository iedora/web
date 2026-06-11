/**
 * The two auth cookies the Next server owns, both HttpOnly:
 *
 *  - `iedora_access`  — the Go access JWT (15 min), mirrored out of the
 *    auth-service JSON response so middleware/RSCs can read it.
 *  - `iedora_refresh` — the opaque refresh token. The Go service sets it
 *    with `Path=/auth` (its own surface); we terminate the browser
 *    connection, so we re-issue it under `Path=/` with our attributes.
 */

export const ACCESS_COOKIE = 'iedora_access'
export const REFRESH_COOKIE = 'iedora_refresh'

/** JSON body of the Go auth endpoints (register/login/refresh). */
export type TokenResponse = {
  accessToken: string
  expiresAt: string // RFC3339
  userId: string
  tenantId?: string
}

/** Cookie write in a shape both `cookies()` and NextResponse accept. */
export type CookieWrite = {
  name: string
  value: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'lax'
    path: string
    expires?: Date
    maxAge?: number
  }
}

const baseOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const

/**
 * Builds the cookie writes for a successful auth response: the access
 * token (expiring with the JWT) and the refresh token extracted from
 * the Go `Set-Cookie` header (keeping its expiry, swapping the path).
 */
export function authCookies(tokens: TokenResponse, setCookieHeaders: string[]): CookieWrite[] {
  const writes: CookieWrite[] = [
    {
      name: ACCESS_COOKIE,
      value: tokens.accessToken,
      options: { ...baseOptions, expires: new Date(tokens.expiresAt) },
    },
  ]
  const refresh = parseRefreshCookie(setCookieHeaders)
  if (refresh) {
    writes.push({
      name: REFRESH_COOKIE,
      value: refresh.value,
      options: { ...baseOptions, expires: refresh.expires },
    })
  }
  return writes
}

/** Cookie writes that delete both auth cookies (sign-out / dead refresh). */
export function clearedAuthCookies(): CookieWrite[] {
  return [ACCESS_COOKIE, REFRESH_COOKIE].map((name) => ({
    name,
    value: '',
    options: { ...baseOptions, maxAge: 0 },
  }))
}

/** Pulls the refresh token value + expiry out of Go's Set-Cookie headers. */
function parseRefreshCookie(headers: string[]): { value: string; expires?: Date } | null {
  for (const header of headers) {
    const [pair, ...attrs] = header.split(';')
    const eq = (pair ?? '').indexOf('=')
    if (eq < 0) continue
    const name = pair!.slice(0, eq).trim()
    if (name !== REFRESH_COOKIE) continue
    const value = pair!.slice(eq + 1).trim()
    if (!value) return null // cleared cookie
    let expires: Date | undefined
    for (const attr of attrs) {
      const [k, v] = attr.split('=')
      if (k?.trim().toLowerCase() === 'expires' && v) {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) expires = d
      }
    }
    return { value, expires }
  }
  return null
}
