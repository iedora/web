import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { getCoreDb } from './db'
import { auditLog } from './schema'

/**
 * Append-only audit log. One row per state-changing event on the auth
 * + admin surface. Writes are non-blocking from the caller's
 * perspective: any error inside `recordAudit` is logged to stderr and
 * swallowed — telemetry must never break a user-facing action.
 *
 * Callers fall into three families:
 *
 *   1. Better-auth hooks (`databaseHooks.user.create.after`,
 *      `session.create.after`) — capture lifecycle events the library
 *      drives.
 *   2. Server actions (`products/core/src/features/admin-*\/actions.ts`)
 *      — capture every staff-initiated mutation right after the
 *      gateway call returns.
 *   3. Guard rejection paths (`requireScope`, `requireStaff`) —
 *      capture authz denials before redirect()/notFound().
 *
 * `event` strings are kebab-namespaced: `<resource>.<verb-past-tense>`.
 * `outcome` is `success | denied | error`. `important` toggles the
 * default-shown filter on the timeline UI — set `false` for high-volume
 * routine events (page views) so the timeline doesn't drown.
 *
 * Caller IP is hashed (SHA-256, hex) — keeps "same actor came back"
 * useful for investigations without retaining raw PII at rest.
 */
export type AuditOutcome = 'success' | 'denied' | 'error'

export type AuditInput = {
  event: string
  outcome: AuditOutcome
  /**
   * Snapshot of who did this. Pass `null` for unauthenticated /
   * system-driven events (e.g. a denial fired by a missing session).
   */
  actor?: {
    userId: string | null
    role?: string | null
    email?: string | null
  } | null
  target?: {
    userId?: string | null
    tenantId?: string | null
    sessionId?: string | null
  } | null
  /**
   * Request headers (from Next's `headers()`). Used to derive the
   * IP hash + user-agent. Pass `null` when the call site has no
   * request context (e.g. a better-auth hook running off-request).
   */
  headers?: Headers | null
  requestPath?: string | null
  meta?: Record<string, unknown> | null
  /** Whether the event surfaces in the default audit timeline. */
  important?: boolean
}

const IP_HEADERS = [
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
] as const

function extractIp(headers: Headers | null | undefined): string | null {
  if (!headers) return null
  for (const h of IP_HEADERS) {
    const raw = headers.get(h)
    if (!raw) continue
    // x-forwarded-for is a comma-separated chain — first hop is the
    // origin client.
    const first = raw.split(',')[0]?.trim()
    if (first) return first
  }
  return null
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex')
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const db = getCoreDb()
    await db.insert(auditLog).values({
      id: randomUUID(),
      event: input.event,
      outcome: input.outcome,
      actorUserId: input.actor?.userId ?? null,
      actorRole: input.actor?.role ?? null,
      actorEmail: input.actor?.email ?? null,
      targetUserId: input.target?.userId ?? null,
      targetTenantId: input.target?.tenantId ?? null,
      targetSessionId: input.target?.sessionId ?? null,
      ipHash: hashIp(extractIp(input.headers ?? null)),
      userAgent: input.headers?.get('user-agent') ?? null,
      requestPath: input.requestPath ?? null,
      meta: input.meta ?? null,
      important: input.important ?? true,
    })
  } catch (err) {
    // Telemetry must never break a real action. Surface in stderr so
    // operators see it in docker logs, then swallow.
    // eslint-disable-next-line no-console
    console.error('[iedora/audit] write failed:', err)
  }
}
