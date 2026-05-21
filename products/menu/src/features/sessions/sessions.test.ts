import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import * as schema from '@/shared/db/schema'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import type { IssueSessionInput, SessionStore } from './ports'
import { revokeSession } from './use-cases/revoke-session'
import { refreshPermissionsForUser } from './use-cases/refresh-permissions'
import { revokeAllForUser } from './use-cases/revoke-all-for-user'

vi.mock('server-only', () => ({}))

let t: TestDb

beforeEach(async () => {
  t = await makeTestDb()
})

afterEach(async () => {
  await t.cleanup()
})

/**
 * PGLite-backed SessionStore — same SQL as the production adapter,
 * pointed at the in-memory DB. Mirrors the fixture pattern used across
 * the other slices.
 */
function makeStore(testDb: TestDb): SessionStore {
  const { db } = testDb
  function mintId() {
    return randomBytes(32).toString('base64url')
  }
  return {
    async issue(input) {
      const id = mintId()
      await db.insert(schema.session).values({ id, ...input })
      return id
    },
    async get(id) {
      const rows = await db
        .select()
        .from(schema.session)
        .where(
          and(
            eq(schema.session.id, id),
            isNull(schema.session.revokedAt),
            sql`${schema.session.expiresAt} > now()`,
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },
    async revoke(id, reason) {
      await db
        .update(schema.session)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(schema.session.id, id), isNull(schema.session.revokedAt)))
    },
    async listActiveForUser(userId) {
      return db
        .select()
        .from(schema.session)
        .where(
          and(
            eq(schema.session.userId, userId),
            isNull(schema.session.revokedAt),
            sql`${schema.session.expiresAt} > now()`,
          ),
        )
    },
    async refreshPermissionsForUser(userId, next) {
      const updated = await db
        .update(schema.session)
        .set({
          roles: next.roles,
          permissions: next.permissions,
          permissionsVersion: sql`${schema.session.permissionsVersion} + 1`,
        })
        .where(
          and(
            eq(schema.session.userId, userId),
            isNull(schema.session.revokedAt),
            sql`${schema.session.expiresAt} > now()`,
          ),
        )
        .returning({ id: schema.session.id })
      return updated.length
    },
    async listAllActive() {
      return db
        .select()
        .from(schema.session)
        .where(
          and(
            isNull(schema.session.revokedAt),
            sql`${schema.session.expiresAt} > now()`,
          ),
        )
    },
    async revokeAllForUser(userId, reason) {
      const updated = await db
        .update(schema.session)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(
          and(
            eq(schema.session.userId, userId),
            isNull(schema.session.revokedAt),
          ),
        )
        .returning({ id: schema.session.id })
      return updated.length
    },
  }
}

function baseInput(overrides: Partial<IssueSessionInput> = {}): IssueSessionInput {
  return {
    userId: 'user-1',
    email: 'a@b.com',
    name: 'Alice',
    roles: [],
    permissions: [],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userAgent: 'jest',
    ipHash: 'aabbcc',
    ...overrides,
  }
}

describe('sessions slice', () => {
  describe('issue + get', () => {
    it('returns the row for a freshly-issued session', async () => {
      const store = makeStore(t)
      const id = await store.issue(baseInput())
      const got = await store.get(id)
      expect(got?.userId).toBe('user-1')
      expect(got?.permissionsVersion).toBe(1)
    })

    it('returns null for an unknown id', async () => {
      const store = makeStore(t)
      const got = await store.get('does-not-exist')
      expect(got).toBeNull()
    })

    it('returns null for an expired session', async () => {
      const store = makeStore(t)
      const id = await store.issue(
        baseInput({ expiresAt: new Date(Date.now() - 1000) }),
      )
      const got = await store.get(id)
      expect(got).toBeNull()
    })
  })

  describe('revokeSession', () => {
    it('marks the row revoked so subsequent get() returns null', async () => {
      const store = makeStore(t)
      const id = await store.issue(baseInput())
      await revokeSession(store, id, 'admin_revoke')
      const got = await store.get(id)
      expect(got).toBeNull()
    })

    it('is idempotent — re-revoking does not overwrite the original reason', async () => {
      const store = makeStore(t)
      const id = await store.issue(baseInput())
      await revokeSession(store, id, 'admin_revoke')
      await revokeSession(store, id, 'logout')

      const rows = await t.db
        .select()
        .from(schema.session)
        .where(eq(schema.session.id, id))
      expect(rows[0]?.revokedReason).toBe('admin_revoke')
    })
  })

  describe('refreshPermissionsForUser', () => {
    it('rewrites permissions on every active session for the user', async () => {
      const store = makeStore(t)
      const a = await store.issue(baseInput({ permissions: ['old:read'] }))
      const b = await store.issue(baseInput({ permissions: ['old:read'] }))

      const touched = await refreshPermissionsForUser(store, 'user-1', {
        roles: ['iedora-admin'],
        permissions: ['qr-codes:read', 'qr-codes:write'],
      })

      expect(touched).toBe(2)
      const got = await store.get(a)
      expect(got?.permissions).toEqual(['qr-codes:read', 'qr-codes:write'])
      expect(got?.roles).toEqual(['iedora-admin'])
      expect(got?.permissionsVersion).toBe(2)
      const gotB = await store.get(b)
      expect(gotB?.permissionsVersion).toBe(2)
    })

    it('skips revoked + expired sessions', async () => {
      const store = makeStore(t)
      const live = await store.issue(baseInput())
      const revoked = await store.issue(baseInput())
      await revokeSession(store, revoked, 'admin_revoke')
      const expired = await store.issue(
        baseInput({ expiresAt: new Date(Date.now() - 1000) }),
      )

      const touched = await refreshPermissionsForUser(store, 'user-1', {
        roles: [],
        permissions: ['new:scope'],
      })

      expect(touched).toBe(1)
      const gotLive = await store.get(live)
      expect(gotLive?.permissions).toEqual(['new:scope'])

      const allRows = await t.db
        .select()
        .from(schema.session)
        .where(eq(schema.session.id, expired))
      expect(allRows[0]?.permissions).toEqual([])
    })

    it('returns 0 when the user has no active sessions', async () => {
      const store = makeStore(t)
      const touched = await refreshPermissionsForUser(store, 'ghost', {
        roles: [],
        permissions: ['x'],
      })
      expect(touched).toBe(0)
    })
  })

  describe('listActiveForUser', () => {
    it('returns only non-revoked, non-expired rows', async () => {
      const store = makeStore(t)
      await store.issue(baseInput())
      const r = await store.issue(baseInput())
      await revokeSession(store, r, 'logout')
      await store.issue(baseInput({ expiresAt: new Date(Date.now() - 1000) }))

      const live = await store.listActiveForUser('user-1')
      expect(live).toHaveLength(1)
    })
  })

  describe('listAllActive', () => {
    it('returns active rows across every user, sorted last-seen desc', async () => {
      const store = makeStore(t)
      await store.issue(baseInput({ userId: 'alice' }))
      await store.issue(baseInput({ userId: 'bob' }))
      const revoked = await store.issue(baseInput({ userId: 'eve' }))
      await revokeSession(store, revoked, 'admin_revoke')

      const all = await store.listAllActive()
      expect(all).toHaveLength(2)
      expect(new Set(all.map((s) => s.userId))).toEqual(new Set(['alice', 'bob']))
    })
  })

  describe('revokeAllForUser', () => {
    it('revokes every active session for the user and leaves others alone', async () => {
      const store = makeStore(t)
      const a = await store.issue(baseInput({ userId: 'target' }))
      const b = await store.issue(baseInput({ userId: 'target' }))
      const c = await store.issue(baseInput({ userId: 'bystander' }))

      const touched = await revokeAllForUser(store, 'target', 'admin_revoke')

      expect(touched).toBe(2)
      expect(await store.get(a)).toBeNull()
      expect(await store.get(b)).toBeNull()
      expect(await store.get(c)).not.toBeNull()
    })

    it('returns 0 when the user has no active sessions', async () => {
      const store = makeStore(t)
      expect(await revokeAllForUser(store, 'ghost', 'admin_revoke')).toBe(0)
    })
  })
})
