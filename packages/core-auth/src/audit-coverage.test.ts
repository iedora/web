import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeTestDb, type TestDb } from '@iedora/db/testing'

import { schema } from './schema'
import { setCoreDbForTesting } from './db'
import { CORE_AUDIT_EVENTS } from './audit-events'
import { TENANT_ROLE_PRESETS, STAFF_ROLE_PRESETS, IEDORA_ADMIN_ROLE } from './role-presets'
import { createTenant } from './tenants'
import { upsertMember, removeMember } from './tenant-members'
import { setActiveTenant } from './sessions'
import {
  setUserScopes,
  banUser,
  unbanUser,
  impersonateUser,
  stopImpersonating,
} from './staff'

/**
 * End-to-end audit coverage — one assertion per state-changing primitive
 * in `@iedora/core-auth`. The contract these tests enforce:
 *
 *   1. Every successful mutation writes exactly the expected event
 *      (no missing audit, no surprise extras).
 *   2. The audit row carries the actor's id + email AND the right
 *      target columns (user / tenant / session as appropriate).
 *   3. Idempotent no-ops (`removeMember` on a phantom membership,
 *      `setActiveTenant` to the same id, `stopImpersonating` on a
 *      session that wasn't impersonating) do NOT pollute the timeline.
 *
 * Wired against PGLite (real Postgres semantics) through the same
 * `@iedora/db/testing` fixture menu uses — so the inserts, the JSON
 * meta column, and the text[] scope arrays all behave like production.
 */

vi.mock('server-only', () => ({}))

const ACTOR = {
  userId: 'usr_actor',
  email: 'actor@example.com',
  role: IEDORA_ADMIN_ROLE,
}
const TARGET_USER = 'usr_target'

let fixture: TestDb<typeof schema>
let teardown: () => void

beforeEach(async () => {
  fixture = await makeTestDb(schema, {
    migrationsFolder: path.join(__dirname, '..', 'drizzle'),
    pgSchema: 'core',
  })
  teardown = setCoreDbForTesting(fixture.db)
  // Seed two users (actor + target) — every primitive needs at least
  // one user row to FK against, even when the test only asserts on
  // the audit row.
  await fixture.db.insert(schema.user).values([
    {
      id: ACTOR.userId,
      email: ACTOR.email,
      name: 'Actor',
      emailVerified: true,
      scopes: [...STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE]],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: TARGET_USER,
      email: 'target@example.com',
      name: 'Target',
      emailVerified: true,
      scopes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ])
})

afterEach(async () => {
  teardown()
  await fixture.cleanup()
})

async function listAudit() {
  return fixture.db.select().from(schema.auditLog)
}

describe('createTenant', () => {
  it('emits tenant.created + tenant.member.added with founder flag', async () => {
    const tenant = await createTenant({
      name: 'Tasca do Audit',
      founder: { userId: TARGET_USER, scopes: TENANT_ROLE_PRESETS.owner },
      actor: ACTOR,
    })
    const rows = await listAudit()
    expect(rows).toHaveLength(2)
    const events = rows.map((r) => r.event).sort()
    expect(events).toEqual(
      [
        CORE_AUDIT_EVENTS.TENANT_CREATED,
        CORE_AUDIT_EVENTS.TENANT_MEMBER_ADDED,
      ].sort(),
    )
    const created = rows.find((r) => r.event === CORE_AUDIT_EVENTS.TENANT_CREATED)!
    expect(created.actorUserId).toBe(ACTOR.userId)
    expect(created.actorEmail).toBe(ACTOR.email)
    expect(created.targetTenantId).toBe(tenant.id)
    expect(created.meta).toMatchObject({ name: 'Tasca do Audit' })

    const member = rows.find((r) => r.event === CORE_AUDIT_EVENTS.TENANT_MEMBER_ADDED)!
    expect(member.targetTenantId).toBe(tenant.id)
    expect(member.targetUserId).toBe(TARGET_USER)
    expect(member.meta).toMatchObject({ founder: true })
  })
})

describe('upsertMember', () => {
  it('first grant → tenant.member.added', async () => {
    const tenant = await createTenant({
      name: 'T', founder: { userId: ACTOR.userId, scopes: TENANT_ROLE_PRESETS.owner }, actor: ACTOR,
    })
    await fixture.db.delete(schema.auditLog)

    await upsertMember({
      tenantId: tenant.id,
      userId: TARGET_USER,
      scopes: TENANT_ROLE_PRESETS.member,
      actor: ACTOR,
    })
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.TENANT_MEMBER_ADDED)
    expect(rows[0]!.targetUserId).toBe(TARGET_USER)
    expect(rows[0]!.targetTenantId).toBe(tenant.id)
  })

  it('re-grant on existing membership → tenant.member.scopes-updated with from/to', async () => {
    const tenant = await createTenant({
      name: 'T', founder: { userId: TARGET_USER, scopes: TENANT_ROLE_PRESETS.member }, actor: ACTOR,
    })
    await fixture.db.delete(schema.auditLog)

    await upsertMember({
      tenantId: tenant.id,
      userId: TARGET_USER,
      scopes: TENANT_ROLE_PRESETS.admin,
      actor: ACTOR,
    })
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.TENANT_MEMBER_SCOPES_UPDATED)
    const meta = rows[0]!.meta as { from: unknown; to: unknown }
    expect(meta.from).toEqual([...TENANT_ROLE_PRESETS.member])
    expect(meta.to).toEqual([...TENANT_ROLE_PRESETS.admin])
  })
})

describe('removeMember', () => {
  it('emits tenant.member.removed', async () => {
    const tenant = await createTenant({
      name: 'T', founder: { userId: TARGET_USER, scopes: TENANT_ROLE_PRESETS.owner }, actor: ACTOR,
    })
    await fixture.db.delete(schema.auditLog)

    await removeMember({ tenantId: tenant.id, userId: TARGET_USER, actor: ACTOR })
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.TENANT_MEMBER_REMOVED)
    expect(rows[0]!.targetUserId).toBe(TARGET_USER)
    expect(rows[0]!.targetTenantId).toBe(tenant.id)
  })

  it('idempotent no-op on phantom membership does NOT write audit', async () => {
    await removeMember({ tenantId: 'phantom', userId: TARGET_USER, actor: ACTOR })
    const rows = await listAudit()
    expect(rows).toHaveLength(0)
  })
})

describe('setActiveTenant', () => {
  it('emits tenant.active.switched on first pin', async () => {
    const tenant = await createTenant({
      name: 'T', founder: { userId: TARGET_USER, scopes: TENANT_ROLE_PRESETS.owner }, actor: ACTOR,
    })
    const sessionId = `sess_${randomUUID()}`
    await fixture.db.insert(schema.session).values({
      id: sessionId,
      token: `tok_${randomUUID()}`,
      userId: TARGET_USER,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await fixture.db.delete(schema.auditLog)

    await setActiveTenant({ sessionId, userId: TARGET_USER, tenantId: tenant.id, actor: ACTOR })
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.TENANT_ACTIVE_SWITCHED)
    expect(rows[0]!.targetSessionId).toBe(sessionId)
    expect(rows[0]!.important).toBe(false)
  })

  it('switching to the same active id is a no-op (no audit row)', async () => {
    const tenant = await createTenant({
      name: 'T', founder: { userId: TARGET_USER, scopes: TENANT_ROLE_PRESETS.owner }, actor: ACTOR,
    })
    const sessionId = `sess_${randomUUID()}`
    await fixture.db.insert(schema.session).values({
      id: sessionId,
      token: `tok_${randomUUID()}`,
      userId: TARGET_USER,
      activeTenantId: tenant.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await fixture.db.delete(schema.auditLog)

    await setActiveTenant({ sessionId, userId: TARGET_USER, tenantId: tenant.id, actor: ACTOR })
    expect(await listAudit()).toHaveLength(0)
  })
})

describe('setUserScopes', () => {
  it('emits user.scopes.updated with from/to delta', async () => {
    await setUserScopes(TARGET_USER, STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE], ACTOR)
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.USER_SCOPES_UPDATED)
    const meta = rows[0]!.meta as { from: unknown; to: unknown }
    expect(meta.from).toBeNull()
    expect(meta.to).toEqual([...STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE]])
  })
})

describe('ban / unban', () => {
  it('banUser emits user.banned with reason + expiry', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000)
    await banUser({ userId: TARGET_USER, reason: 'abuse', expiresAt, actor: ACTOR })
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.USER_BANNED)
    expect(rows[0]!.targetUserId).toBe(TARGET_USER)
    expect(rows[0]!.meta).toMatchObject({
      reason: 'abuse',
      expiresAt: expiresAt.toISOString(),
    })
  })

  it('unbanUser emits user.unbanned', async () => {
    await unbanUser(TARGET_USER, ACTOR)
    const rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.USER_UNBANNED)
  })
})

describe('impersonation', () => {
  it('start + stop write paired audit rows', async () => {
    const sessionId = `sess_${randomUUID()}`
    await fixture.db.insert(schema.session).values({
      id: sessionId,
      token: `tok_${randomUUID()}`,
      userId: ACTOR.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await impersonateUser({
      actorSessionId: sessionId,
      actorUserId: ACTOR.userId,
      targetUserId: TARGET_USER,
      actor: ACTOR,
    })
    let rows = await listAudit()
    expect(rows.map((r) => r.event)).toContain(CORE_AUDIT_EVENTS.USER_IMPERSONATED)
    const startRow = rows.find((r) => r.event === CORE_AUDIT_EVENTS.USER_IMPERSONATED)!
    expect(startRow.targetUserId).toBe(TARGET_USER)
    expect(startRow.targetSessionId).toBe(sessionId)

    await fixture.db.delete(schema.auditLog)
    await stopImpersonating(sessionId, ACTOR)
    rows = await listAudit()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toBe(CORE_AUDIT_EVENTS.USER_IMPERSONATION_STOPPED)
    expect(rows[0]!.targetSessionId).toBe(sessionId)
  })

  it('stopImpersonating on a non-impersonating session is a no-op', async () => {
    const sessionId = `sess_${randomUUID()}`
    await fixture.db.insert(schema.session).values({
      id: sessionId,
      token: `tok_${randomUUID()}`,
      userId: ACTOR.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await stopImpersonating(sessionId, ACTOR)
    expect(await listAudit()).toHaveLength(0)
  })
})
