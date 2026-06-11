import { cookies } from 'next/headers'

import { ACCESS_COOKIE } from './cookies'
import { decodeJwt } from './jwt'

/** The signed-in principal, decoded from the access-token cookie. */
export type Session = {
  userId: string
  tenantId: string | null
  roles: string[]
  email: string | null
  /** Access-token expiry (unix ms). Middleware refreshes before this. */
  expiresAt: number
}

/** Decodes a session from a raw access token; null if invalid/expired. */
export function sessionFromToken(token: string): Session | null {
  const claims = decodeJwt(token)
  if (!claims || claims.typ !== 'access') return null
  if (claims.exp * 1000 <= Date.now()) return null
  return {
    userId: claims.sub,
    tenantId: claims.tid ?? null,
    roles: claims.roles ?? [],
    email: claims.email ?? null,
    expiresAt: claims.exp * 1000,
  }
}

/**
 * Reads the session from the request's access cookie. Middleware keeps
 * the cookie fresh on protected routes, so RSCs can rely on this being
 * current there; elsewhere a null just means "not signed in".
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies()
  const token = store.get(ACCESS_COOKIE)?.value
  return token ? sessionFromToken(token) : null
}
