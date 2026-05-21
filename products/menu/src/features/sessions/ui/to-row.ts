import type { AuthMethod, ZitadelUserSummary } from '../adapters/zitadel-enrichment'
import type { SessionRecord } from '../ports'
import type { SessionAdminRow } from './sessions-admin'

/**
 * Project a `SessionRecord` (plus Zitadel enrichment) into the row shape
 * the client component renders. Lives in its own (non-`'use client'`)
 * module so the page (RSC) can call it without React's "cannot call
 * client function from server" guard tripping.
 */
export function toSessionAdminRow(
  rec: SessionRecord,
  currentSid: string | null,
  user: ZitadelUserSummary | undefined,
  methods: AuthMethod[] | undefined,
): SessionAdminRow {
  return {
    id: rec.id,
    userId: rec.userId,
    email: user?.email ?? rec.email,
    displayName: user?.displayName ?? rec.name,
    username: user?.username ?? null,
    state: user?.state ?? null,
    emailVerified: user?.emailVerified ?? null,
    roles: rec.roles,
    permissions: rec.permissions,
    permissionsVersion: rec.permissionsVersion,
    createdAt: rec.createdAt.toISOString(),
    lastSeenAt: formatRelative(rec.lastSeenAt),
    expiresAt: rec.expiresAt.toISOString().slice(0, 10),
    userAgent: rec.userAgent,
    ipHashShort: rec.ipHash ? rec.ipHash.slice(0, 12) : null,
    authMethods: methods ?? [],
    isOwnSession: currentSid !== null && rec.id === currentSid,
  }
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}
