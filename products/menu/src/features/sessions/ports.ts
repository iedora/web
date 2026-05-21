/**
 * Server-side session store. Replaces the self-contained JWE cookie that
 * carried the user's claims directly — the cookie now holds an opaque
 * pointer (`sid`) to a row owned by this port. Permissions and roles live
 * on the row so a grant change (Zitadel webhook) or admin revoke is
 * reflected on the very next request, without waiting for the cookie's
 * 7-day TTL.
 *
 * No `next` / Drizzle types leak through. Production wires the Drizzle
 * adapter; tests wire fakes.
 */

export type SessionRecord = {
  id: string
  userId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  permissionsVersion: number
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedReason: string | null
  userAgent: string | null
  ipHash: string | null
}

export type IssueSessionInput = {
  userId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  expiresAt: Date
  userAgent: string | null
  ipHash: string | null
}

export type RevokeReason =
  | 'logout'
  | 'admin_revoke'
  | 'user_disabled'
  | 'token_rotation'

export interface SessionStore {
  /**
   * Inserts a new session row and returns the freshly-minted opaque id
   * (the value the cookie will carry).
   */
  issue(input: IssueSessionInput): Promise<string>

  /**
   * Looks up an active session by id. Returns null when the row is
   * missing, expired, or revoked. Callers MUST treat a null result as
   * "no session" — same as a missing cookie. Implementations bump
   * `last_seen_at` opportunistically (debounced to avoid a write per
   * request).
   */
  get(id: string): Promise<SessionRecord | null>

  /**
   * Marks a single session as revoked. Idempotent: re-revoking a row
   * that is already revoked is a no-op.
   */
  revoke(id: string, reason: RevokeReason): Promise<void>

  /**
   * Lists every non-revoked, non-expired session for a user. Used by the
   * admin UI (Fase 2) and by the webhook to fan permissions out across
   * the user's open devices.
   */
  listActiveForUser(userId: string): Promise<SessionRecord[]>

  /**
   * Rewrites `permissions` + `roles` on every active session for a user
   * and bumps `permissions_version`. Called from the Zitadel webhook
   * after a grant change so the new scope set takes effect on the very
   * next request without re-auth.
   */
  refreshPermissionsForUser(
    userId: string,
    next: { roles: string[]; permissions: string[] },
  ): Promise<number>

  /**
   * Lists every non-revoked, non-expired session across ALL users,
   * ordered by `last_seen_at` desc so the most recently active sort
   * first. Powers the admin UI — caller MUST gate by `requireIedoraAdmin`
   * because this is cross-tenant.
   */
  listAllActive(): Promise<SessionRecord[]>

  /**
   * Revoke every active session a user has, with one reason. Returns the
   * number of rows touched. Used by the admin UI's "log this user out
   * everywhere" button.
   */
  revokeAllForUser(userId: string, reason: RevokeReason): Promise<number>
}
