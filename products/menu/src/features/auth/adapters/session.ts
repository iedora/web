import 'server-only'
import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt, base64url } from 'jose'
import { isSameOriginPath } from '@/shared/url-validate'

/**
 * Menu's session is a server-side row (see `@/features/sessions`) plus a
 * cookie holding an opaque pointer to it. The cookie is JWE-sealed
 * (compact, alg=dir, enc=A256GCM) — sealing keeps the cookie value
 * opaque to passive log capture and lets a secret rotation
 * (`tofu apply -replace=random_password.menu_session_secret`) cleanly
 * invalidate every issued cookie at once.
 *
 * Trade-offs vs the pre-#21 self-contained cookie:
 *   - Admin revoke + scope refresh now apply on the very next request
 *     instead of waiting up to 7d for the cookie to expire.
 *   - One PK lookup per page render (`session.id` is a 32-byte PK).
 *
 * Cookie name is `menu_session_v2` — bumped on the cutover so any
 * lingering self-contained cookie issued before the migration fails
 * closed (no `sid` claim → `null` → user re-auths cleanly).
 */

export const SESSION_COOKIE = 'menu_session_v2'
/**
 * Cookie lifetime. The DB row's `expires_at` is the authoritative bound
 * — `get()` rejects rows past it — but we keep the cookie's `maxAge`
 * + JWE `exp` in sync so the browser drops dead cookies without an
 * extra round-trip.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7d

/**
 * The cookie payload — opaque pointer to a server-side row. Everything
 * else (user identity, roles, permissions) lives on the row.
 */
export type SessionPointer = {
  /** Opaque server-side session id (256-bit, base64url). */
  sid: string
  /** Zitadel `sub` claim. Mirrored here so a fast invariant check can
   * reject a tampered cookie before any DB lookup. */
  sub: string
  /** Unix-seconds expiry. JWE itself rejects past-exp on decrypt. */
  exp: number
}

/**
 * Subset of session data exposed to callers. Identical shape to the
 * pre-#21 type so the auth slice's use-cases and the entire DAL didn't
 * have to change — the data just comes from the DB row now instead of
 * the cookie body.
 */
export type Session = {
  user: {
    /** Zitadel `sub` claim — the immutable user id. */
    id: string
    email: string
    name: string
    /** Project-role keys (e.g. `iedora-admin`). Kept for audit/debug. */
    roles: string[]
    /** Flat scopes (e.g. `qr-codes:write`) — authoritative for `requireScope`. */
    permissions: string[]
  }
  /** Unix-seconds expiry — mirrors the DB row's `expires_at`. */
  expiresAt: number
  /** Server-side session id. Surfaced so admin tooling + logout can revoke. */
  sid: string
}

/**
 * Derive the 32-byte symmetric key. We accept any secret ≥ 32 chars and
 * hash it down to a fixed-width key so callers don't have to think about
 * length. Same key for encrypt/decrypt; deterministic given the secret.
 */
function deriveKey(secret: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(secret).digest())
}

export function makeSessionCookie(secret: string) {
  // Length is enforced at the env boundary (`@/shared/env`). Constructing
  // here with the build-time stub (empty strings) must not throw — we run
  // `next build` against an empty env to collect page data.
  const key = deriveKey(secret)

  return {
    /** Encrypts a pointer into a compact JWE string suitable for a cookie. */
    async seal(pointer: SessionPointer): Promise<string> {
      return new EncryptJWT({
        sid: pointer.sid,
        sub: pointer.sub,
      })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime(pointer.exp)
        .encrypt(key)
    },

    /**
     * Decrypts + validates a cookie value. Returns null on any failure
     * (tampered ciphertext, wrong key, missing sid, expired). Caller
     * treats `null` as "no session" — same as a missing cookie.
     *
     * NOTE: this does NOT consult the server-side store. Callers
     * (production: `drizzleAuthGateway.getSession`) must look the `sid`
     * up against `SessionStore.get` and reject revoked / expired rows.
     */
    async open(jwe: string): Promise<SessionPointer | null> {
      try {
        const { payload } = await jwtDecrypt(jwe, key)
        const sid = payload.sid
        const sub = payload.sub
        const exp = payload.exp
        if (
          typeof sid !== 'string' ||
          typeof sub !== 'string' ||
          typeof exp !== 'number'
        ) {
          return null
        }
        return { sid, sub, exp }
      } catch {
        return null
      }
    },
  }
}

export type SessionCookie = ReturnType<typeof makeSessionCookie>

/**
 * Short-lived envelope holding the OIDC `state` + PKCE code_verifier
 * between the /api/auth/login redirect and the /api/auth/callback
 * exchange. Encrypted with the same key as the session cookie — there's
 * no value in a separate one, and a single source of truth simplifies
 * rotation.
 */
export type OidcFlowState = {
  state: string
  codeVerifier: string
  next: string
}

export const OIDC_FLOW_COOKIE = 'menu_oidc_flow'
export const OIDC_FLOW_TTL_SECONDS = 60 * 10 // 10 minutes

export function makeOidcFlowAdapter(secret: string) {
  const key = deriveKey(secret)
  return {
    async seal(flow: OidcFlowState): Promise<string> {
      return new EncryptJWT({
        state: flow.state,
        codeVerifier: flow.codeVerifier,
        next: flow.next,
      })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime(`${OIDC_FLOW_TTL_SECONDS}s`)
        .encrypt(key)
    },
    async open(jwe: string): Promise<OidcFlowState | null> {
      try {
        const { payload } = await jwtDecrypt(jwe, key)
        const state = payload.state
        const codeVerifier = payload.codeVerifier
        const next = payload.next
        if (
          typeof state !== 'string' ||
          typeof codeVerifier !== 'string' ||
          typeof next !== 'string'
        ) {
          return null
        }
        // Re-validate the next URL on read — defence-in-depth against a
        // future bug at write time that lets through an off-site redirect.
        if (!isSameOriginPath(next)) return null
        return { state, codeVerifier, next }
      } catch {
        return null
      }
    },
  }
}

/**
 * Re-exported from `@/shared/url-validate`. URL hygiene (path
 * validation + absolute URL building) lives in `@/shared/url*` as the
 * single source of truth; this re-export keeps in-slice imports
 * stable. New consumers should import from `@/shared/url-validate`
 * (validation) or `@/shared/url` (building) directly.
 */
export { isSameOriginPath }

/**
 * The bytes used to derive the JWE key from an arbitrary secret. Exposed so
 * tests can assert the derivation is deterministic (rotation predictability).
 */
export const _internals = { deriveKey, base64url }
