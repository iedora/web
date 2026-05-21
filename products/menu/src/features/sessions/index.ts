import 'server-only'
import { cache } from 'react'
import { drizzleSessionStore } from './adapters/drizzle'
import { revokeSession as _revokeSession } from './use-cases/revoke-session'
import { refreshPermissionsForUser as _refreshPermissionsForUser } from './use-cases/refresh-permissions'
import { revokeAllForUser as _revokeAllForUser } from './use-cases/revoke-all-for-user'
import type { RevokeReason } from './ports'

/**
 * Public API of the sessions slice. Production wires the Drizzle-backed
 * SessionStore; tests import the use-cases directly and pass fakes.
 *
 * Read-side (lookup-by-id, list-for-user) is consumed directly by the
 * auth slice and the admin UI — those call `sessionStore` below.
 * Write-side mutations always go through the use-case wrappers so audit
 * + telemetry can hang off a single chokepoint.
 */
export const sessionStore = drizzleSessionStore

export function revokeSession(id: string, reason: RevokeReason) {
  return _revokeSession(drizzleSessionStore, id, reason)
}

export function refreshPermissionsForUser(
  userId: string,
  next: { roles: string[]; permissions: string[] },
) {
  return _refreshPermissionsForUser(drizzleSessionStore, userId, next)
}

export function revokeAllForUser(userId: string, reason: RevokeReason) {
  return _revokeAllForUser(drizzleSessionStore, userId, reason)
}

/**
 * `React.cache()`-memoized listing for the admin UI. Cross-tenant —
 * callers MUST gate by `requireIedoraAdmin` before calling.
 */
export const listAllActiveSessions = cache(() => drizzleSessionStore.listAllActive())

export type {
  SessionRecord,
  SessionStore,
  IssueSessionInput,
  RevokeReason,
} from './ports'
