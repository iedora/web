import type { RevokeReason, SessionStore } from '../ports'

/**
 * Revoke every active session a user has. Returns the count of touched
 * rows — 0 is legitimate (the user might have no open sessions).
 *
 * Used by the admin UI's "log this user out everywhere" button, and (in
 * the future) by an automatic flow when a user is disabled in Zitadel.
 */
export async function revokeAllForUser(
  store: SessionStore,
  userId: string,
  reason: RevokeReason,
): Promise<number> {
  return store.revokeAllForUser(userId, reason)
}
