/**
 * Audit-read slice ports. Read-only — the write path lives in
 * `@iedora/core-auth/audit::recordAudit` and is invoked from server actions
 * + better-auth hooks. This slice only LISTS what was written.
 */

export type AuditEntry = {
  id: string
  at: Date
  event: string
  outcome: 'success' | 'denied' | 'error' | string
  actorUserId: string | null
  actorRole: string | null
  actorEmail: string | null
  targetUserId: string | null
  targetTenantId: string | null
  targetSessionId: string | null
  ipHash: string | null
  userAgent: string | null
  requestPath: string | null
  meta: Record<string, unknown> | null
  important: boolean
}

export type ListAuditInput = {
  /** Substring match on event name (case-insensitive prefix). */
  event?: string
  /** Substring match on actor email. */
  actorEmail?: string
  /** Exact match on the target user id (for the user-detail panel). */
  targetUserId?: string
  /** Exact match on the target org id (for the org-detail panel). */
  targetTenantId?: string
  /** Show only important events when true. */
  importantOnly?: boolean
  page: number
  pageSize: number
}

export type ListAuditResult = {
  entries: ReadonlyArray<AuditEntry>
  total: number
  page: number
  pageSize: number
}

export interface AuditGateway {
  list(input: ListAuditInput): Promise<ListAuditResult>
}
