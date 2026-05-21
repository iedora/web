import 'server-only'
import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt, base64url } from 'jose'

/**
 * Menu's session is a single encrypted cookie (JWE compact, alg=dir,
 * enc=A256GCM). Self-contained: cookie ⇄ session, no server-side store.
 *
 * Trade-off: a user disabled in Zitadel mid-session keeps the menu session
 * until it expires (up to `SESSION_TTL_SECONDS`). Acceptable pre-customer;
 * revisit when we need server-initiated revocation (abuse handling).
 *
 * The encryption key is derived (sha256) from the env-supplied
 * MENU_SESSION_SECRET — Zitadel TF mints that secret in state
 * (random_password.menu_session_secret), so rotation = tofu apply
 * -replace and all live sessions invalidate gracefully (cookies become
 * undecryptable → DAL bounces every user through OIDC again).
 */

export const SESSION_COOKIE = 'menu_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7d

/** Subset of token claims menu keeps in the cookie. Tiny on purpose. */
export type Session = {
  user: {
    /** Zitadel `sub` claim — the immutable user id. */
    id: string
    email: string
    name: string
    /**
     * Zitadel project-role keys asserted on the iedora project (e.g.
     * `'iedora-admin'`). What the user was literally granted. Kept for
     * audit / debug. Authorization gates read `permissions` instead.
     */
    roles: string[]
    /**
     * Flat scope strings (e.g. `'qr-codes:write'`), produced by the
     * Zitadel Actions v2 webhook at `/api/zitadel/permissions` which
     * expands bundle role-grants into concrete scopes. Authoritative
     * for `requireScope(scope)` checks. Frozen at login time — a fresh
     * grant requires re-auth to take effect.
     */
    permissions: string[]
  }
  /** Unix-seconds expiry. Cheap to compare without parsing the JWE. */
  expiresAt: number
}

/**
 * Derive the 32-byte symmetric key. We accept any secret ≥ 32 chars and
 * hash it down to a fixed-width key so callers don't have to think about
 * length. Same key for encrypt/decrypt; deterministic given the secret.
 */
function deriveKey(secret: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(secret).digest())
}

export function makeSessionAdapter(secret: string) {
  // Length is enforced at the env boundary (`@/shared/env`). Constructing
  // here with the build-time stub (empty strings) must not throw — we run
  // `next build` against an empty env to collect page data.
  const key = deriveKey(secret)

  return {
    /** Encrypts `session` into a compact JWE string suitable for a cookie. */
    async seal(session: Session): Promise<string> {
      return new EncryptJWT({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        roles: session.user.roles,
        permissions: session.user.permissions,
      })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime(session.expiresAt)
        .encrypt(key)
    },

    /**
     * Decrypts + validates a cookie value. Returns null on any failure
     * (tampered ciphertext, wrong key, expired). Caller treats `null` as
     * "no session" — same as a missing cookie.
     */
    async open(jwe: string): Promise<Session | null> {
      try {
        const { payload } = await jwtDecrypt(jwe, key)
        const sub = payload.sub
        const email = payload.email
        const name = payload.name
        const exp = payload.exp
        if (
          typeof sub !== 'string' ||
          typeof email !== 'string' ||
          typeof name !== 'string' ||
          typeof exp !== 'number'
        ) {
          return null
        }
        // Forward-compatible additions. Pre-roles cookies (very old) and
        // pre-permissions cookies (sealed before the Zitadel Action v2
        // shipped) lack the new fields; treat as `[]` so existing
        // sessions keep working until they expire and the user re-auths.
        const rawRoles = payload.roles
        const roles = Array.isArray(rawRoles)
          ? rawRoles.filter((r): r is string => typeof r === 'string')
          : []
        const rawPermissions = payload.permissions
        const permissions = Array.isArray(rawPermissions)
          ? rawPermissions.filter((p): p is string => typeof p === 'string')
          : []
        return {
          user: { id: sub, email, name, roles, permissions },
          expiresAt: exp,
        }
      } catch {
        return null
      }
    },
  }
}

export type SessionAdapter = ReturnType<typeof makeSessionAdapter>

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
 * Same-origin path validator. Rejects absolute URLs, protocol-relative
 * URLs (`//evil`), and the `/\\` bypass trick. Re-used by login + callback.
 */
export function isSameOriginPath(raw: string): boolean {
  if (!raw) return false
  if (!raw.startsWith('/')) return false
  if (raw.startsWith('//')) return false
  if (raw.startsWith('/\\')) return false
  return true
}

/**
 * The bytes used to derive the JWE key from an arbitrary secret. Exposed so
 * tests can assert the derivation is deterministic (rotation predictability).
 */
export const _internals = { deriveKey, base64url }
