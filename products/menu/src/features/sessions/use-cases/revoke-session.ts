import type { RevokeReason, SessionStore } from '../ports'

/**
 * Revoke a single session by id. Returns whether the row existed and was
 * touched — used by the admin UI to surface a "no-op (already revoked)"
 * vs "revoked just now" notice.
 */
export async function revokeSession(
  store: SessionStore,
  id: string,
  reason: RevokeReason,
): Promise<void> {
  await store.revoke(id, reason)
}
