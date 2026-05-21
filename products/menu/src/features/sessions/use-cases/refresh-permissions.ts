import type { SessionStore } from '../ports'

/**
 * Push a fresh `roles` + `permissions` set onto every active session for
 * a user. Called from the Zitadel Actions v2 webhook after a grant change
 * so the new scope set takes effect on the next request — the user does
 * NOT have to re-authenticate.
 *
 * Returns the number of session rows that were updated. Zero is a
 * legitimate outcome (no active sessions for that user) and not an
 * error.
 */
export async function refreshPermissionsForUser(
  store: SessionStore,
  userId: string,
  next: { roles: string[]; permissions: string[] },
): Promise<number> {
  return store.refreshPermissionsForUser(userId, next)
}
