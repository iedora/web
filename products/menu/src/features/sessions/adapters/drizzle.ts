import 'server-only'
import { randomBytes } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { session } from '@/shared/db/schema'
import type {
  IssueSessionInput,
  RevokeReason,
  SessionRecord,
  SessionStore,
} from '../ports'

/**
 * 256-bit opaque session id, base64url-encoded → 43 chars, urlsafe, no
 * padding. Cryptographically random — never derived from user data.
 * Stored verbatim in the row's PK and inside the JWE cookie payload.
 */
function mintSessionId(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Debounce window for `last_seen_at` updates. Touching the row on every
 * single request would make hot pages page-write per render — and
 * `last_seen_at` is only ever read by the admin UI, which doesn't care
 * about second-level resolution. One write per 60s per session.
 */
const LAST_SEEN_TOUCH_INTERVAL_MS = 60_000

function rowToRecord(row: typeof session.$inferSelect): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    name: row.name,
    roles: row.roles,
    permissions: row.permissions,
    permissionsVersion: row.permissionsVersion,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    userAgent: row.userAgent,
    ipHash: row.ipHash,
  }
}

export const drizzleSessionStore: SessionStore = {
  async issue(input: IssueSessionInput): Promise<string> {
    const id = mintSessionId()
    await db.insert(session).values({
      id,
      userId: input.userId,
      email: input.email,
      name: input.name,
      roles: input.roles,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipHash: input.ipHash,
    })
    return id
  },

  async get(id: string): Promise<SessionRecord | null> {
    const rows = await db
      .select()
      .from(session)
      .where(
        and(
          eq(session.id, id),
          isNull(session.revokedAt),
          gt(session.expiresAt, sql`now()`),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null

    // Debounced touch — skip the write if last_seen_at is fresh. Saves a
    // page-write per render on hot pages without losing audit fidelity.
    const ageMs = Date.now() - row.lastSeenAt.getTime()
    if (ageMs > LAST_SEEN_TOUCH_INTERVAL_MS) {
      // Fire-and-forget: the next request will see the updated timestamp;
      // failing here would needlessly fail the page render.
      void db
        .update(session)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(session.id, id))
    }
    return rowToRecord(row)
  },

  async revoke(id: string, reason: RevokeReason): Promise<void> {
    await db
      .update(session)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(eq(session.id, id), isNull(session.revokedAt)))
  },

  async listActiveForUser(userId: string): Promise<SessionRecord[]> {
    const rows = await db
      .select()
      .from(session)
      .where(
        and(
          eq(session.userId, userId),
          isNull(session.revokedAt),
          gt(session.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(session.lastSeenAt))
    return rows.map(rowToRecord)
  },

  async refreshPermissionsForUser(
    userId: string,
    next: { roles: string[]; permissions: string[] },
  ): Promise<number> {
    const updated = await db
      .update(session)
      .set({
        roles: next.roles,
        permissions: next.permissions,
        permissionsVersion: sql`${session.permissionsVersion} + 1`,
      })
      .where(
        and(
          eq(session.userId, userId),
          isNull(session.revokedAt),
          gt(session.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: session.id })
    return updated.length
  },

  async listAllActive(): Promise<SessionRecord[]> {
    const rows = await db
      .select()
      .from(session)
      .where(
        and(isNull(session.revokedAt), gt(session.expiresAt, sql`now()`)),
      )
      .orderBy(desc(session.lastSeenAt))
    return rows.map(rowToRecord)
  },

  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
  ): Promise<number> {
    const updated = await db
      .update(session)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(eq(session.userId, userId), isNull(session.revokedAt)),
      )
      .returning({ id: session.id })
    return updated.length
  },
}
