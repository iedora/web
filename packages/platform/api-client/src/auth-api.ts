/**
 * Server-to-server calls against the Go auth service. Each token-minting
 * call returns the parsed JSON body plus the raw Set-Cookie headers so
 * the caller can re-issue the refresh cookie (see cookies.ts).
 */
import { AUTH_URL } from './config'
import type { TokenResponse } from './cookies'
import { REFRESH_COOKIE } from './cookies'
import { ApiError } from './error'

export type AuthResult = {
  tokens: TokenResponse
  setCookies: string[]
}

async function tokenCall(path: string, init: RequestInit): Promise<AuthResult> {
  const res = await fetch(`${AUTH_URL}${path}`, { ...init, cache: 'no-store' })
  if (!res.ok) {
    throw new ApiError(res.status, await safeError(res))
  }
  return {
    tokens: (await res.json()) as TokenResponse,
    setCookies: res.headers.getSetCookie(),
  }
}

export function login(email: string, password: string): Promise<AuthResult> {
  return tokenCall('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function register(email: string, password: string, name: string): Promise<AuthResult> {
  return tokenCall('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
}

/**
 * Rotates the refresh token. Returns null when the token is dead
 * (expired / revoked / reused) — callers clear cookies and re-auth.
 */
export async function refreshTokens(refreshToken: string): Promise<AuthResult | null> {
  try {
    return await tokenCall('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${refreshToken}` },
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

/** Revokes the session family; idempotent on the Go side. */
export async function logout(refreshToken: string): Promise<void> {
  await fetch(`${AUTH_URL}/auth/logout`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE}=${refreshToken}` },
    cache: 'no-store',
  })
}

/**
 * Provisions a tenant owned by the authenticated user. The caller must
 * refresh afterwards so the access token picks up the new tenant id.
 */
export async function createTenant(accessToken: string, name: string): Promise<{ tenantId: string }> {
  const res = await fetch(`${AUTH_URL}/auth/tenants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name }),
    cache: 'no-store',
  })
  if (!res.ok) throw new ApiError(res.status, await safeError(res))
  return (await res.json()) as { tenantId: string }
}

async function safeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? res.statusText
  } catch {
    return res.statusText
  }
}
