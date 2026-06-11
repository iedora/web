/**
 * Minimal JWT payload decode — NO signature verification, on purpose.
 *
 * The access token only ever reaches this code from the `iedora_access`
 * HttpOnly cookie, which is written exclusively by our own server code
 * from Go auth-service responses. Every real API call is verified by
 * the Go services against the Ed25519 key; verifying again here would
 * add a JWKS round-trip without moving the trust boundary.
 */

/** Claims minted by the Go auth service (`internal/auth/crypto/jwt.go`). */
export type AccessClaims = {
  sub: string // user id
  tid?: string // active tenant id (absent until the user has one)
  sid?: string // session family id
  roles?: string[]
  email?: string
  exp: number // unix seconds
  typ: string // "access"
}

/** Decodes the payload of a JWT, returning null on any malformation. */
export function decodeJwt(token: string): AccessClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64)
    const claims = JSON.parse(json) as AccessClaims
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
      return null
    }
    return claims
  } catch {
    return null
  }
}
