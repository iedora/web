import 'server-only'
import { cache } from 'react'
import { drizzleSessionStore } from './adapters/drizzle'
import {
  getAuthMethodsBulk,
  getUserSummaries,
  type AuthMethod,
  type ZitadelUserSummary,
} from './adapters/zitadel-enrichment'
import { computeSessionStats, type SessionStats } from './stats'
import { revokeSession as _revokeSession } from './use-cases/revoke-session'
import { refreshPermissionsForUser as _refreshPermissionsForUser } from './use-cases/refresh-permissions'
import { revokeAllForUser as _revokeAllForUser } from './use-cases/revoke-all-for-user'
import type { RevokeReason, SessionRecord } from './ports'

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

export type EnrichedAdminPayload = {
  /** Live session rows. */
  rows: SessionRecord[]
  /** Pure-function stats derived from `rows`. */
  stats: SessionStats
  /** Per-userId Zitadel profile data. Missing userIds → render fallback. */
  users: Map<string, ZitadelUserSummary>
  /** Per-userId MFA method list. Missing → assume zero methods. */
  authMethods: Map<string, AuthMethod[]>
  /** Wall clock at the time `stats` was computed — UI uses it for "X ago" labels. */
  snapshotAt: Date
}

/**
 * One-call data fetch for the admin page: rows + stats + Zitadel
 * enrichment. The two Zitadel fetches run in parallel; both fail soft
 * (empty maps) so a Zitadel outage degrades the table to "no extras"
 * instead of blanking the page.
 */
export const loadAdminPayload = cache(async (): Promise<EnrichedAdminPayload> => {
  const rows = await drizzleSessionStore.listAllActive()
  const distinctUserIds = Array.from(new Set(rows.map((r) => r.userId)))
  const [users, authMethods] = await Promise.all([
    getUserSummaries(distinctUserIds),
    getAuthMethodsBulk(distinctUserIds),
  ])
  return {
    rows,
    stats: computeSessionStats(rows),
    users,
    authMethods,
    snapshotAt: new Date(),
  }
})

export type {
  SessionRecord,
  SessionStore,
  IssueSessionInput,
  RevokeReason,
} from './ports'
export type { SessionStats } from './stats'
export type { ZitadelUserSummary, AuthMethod } from './adapters/zitadel-enrichment'
