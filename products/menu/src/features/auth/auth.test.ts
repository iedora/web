import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/shared/db/schema'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import type { IdentityGateway, Organization } from '@/features/identity'
import type { Session } from './adapters/session'
import type { AuthGateway } from './ports'
import { verifySession } from './use-cases/verify-session'
import { requireRestaurantAccess } from './use-cases/require-restaurant-access'
import { requireIedoraAdmin } from './use-cases/require-iedora-admin'
import { requireScope } from './use-cases/require-scope'
import { IEDORA_ADMIN_ROLE } from './roles'
import { SCOPES } from './scopes'

// The use-cases call next/navigation's `redirect()`, which only works inside
// a real Next request scope. In Vitest we replace it with a throw so the
// assertion side of the test can detect the redirect path.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`__REDIRECT__:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('__NOT_FOUND__')
  }),
}))

// `server-only` would throw at import-time outside a Next server context;
// in Vitest we neutralise it.
vi.mock('server-only', () => ({}))

let t: TestDb

beforeEach(async () => {
  t = await makeTestDb()
})

afterEach(async () => {
  await t.cleanup()
})

function makeSession(opts: {
  userId: string
  roles?: string[]
  permissions?: string[]
}): Session {
  return {
    user: {
      id: opts.userId,
      email: 'u@example.test',
      name: 'U',
      roles: opts.roles ?? [],
      permissions: opts.permissions ?? [],
    },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }
}

/**
 * Hand-rolled `AuthGateway` whose restaurant lookups run against the test
 * PGLite db, so we exercise real Drizzle queries (and therefore real
 * Postgres semantics) without standing up the OIDC adapter.
 */
function makeAuthGateway(
  testDb: TestDb,
  session: Session | null,
): AuthGateway {
  return {
    async getSession() {
      return session
    },
    async findRestaurantByIdInOrg({ restaurantId, organizationId }) {
      const rows = await testDb.db
        .select({ id: schema.restaurant.id })
        .from(schema.restaurant)
        .where(
          and(
            eq(schema.restaurant.id, restaurantId),
            eq(schema.restaurant.organizationId, organizationId),
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },
    async findRestaurantBySlugInOrg({ slug, organizationId }) {
      const rows = await testDb.db
        .select({
          id: schema.restaurant.id,
          name: schema.restaurant.name,
          slug: schema.restaurant.slug,
        })
        .from(schema.restaurant)
        .where(
          and(
            eq(schema.restaurant.slug, slug),
            eq(schema.restaurant.organizationId, organizationId),
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },
  }
}

/**
 * Fake IdentityGateway. In production this calls Zitadel over HTTP; in
 * tests we hand it a static list keyed by userId so the use-cases can
 * exercise the "user belongs to org" join purely against the membership
 * map the test set up.
 */
function makeIdentityGateway(
  byUser: Record<string, Organization[]>,
): IdentityGateway {
  return {
    async listOrganizations(userId) {
      return byUser[userId] ?? []
    },
    async createOrganization() {
      throw new Error('not used in these tests')
    },
    async setActiveOrganization() {
      return true
    },
  }
}

describe('verifySession', () => {
  it('redirects to /api/auth/login when there is no session', async () => {
    const gw: AuthGateway = {
      getSession: async () => null,
    } as unknown as AuthGateway

    // The login route lives on menu's OWN host. Bouncing direct to Zitadel
    // skips the PKCE-state-cookie hand-off and breaks the dance.
    await expect(verifySession(gw)).rejects.toThrow(
      '__REDIRECT__:/api/auth/login',
    )
  })

  it('returns the session when present', async () => {
    const session = makeSession({ userId: 'u1' })
    const gw: AuthGateway = {
      getSession: async () => session,
    } as unknown as AuthGateway

    await expect(verifySession(gw)).resolves.toBe(session)
  })
})

describe('requireRestaurantAccess', () => {
  beforeEach(async () => {
    // Seed: restaurant r1 belongs to org o1. Zitadel tells us "u1 is a
    // member of o1" via the IdentityGateway — we wire that mapping in each
    // test below.
    await t.db.insert(schema.restaurant).values({
      id: 'r1',
      organizationId: 'o1',
      slug: 'sushi',
      name: 'Sushi',
    })
  })

  it('returns the restaurant context when the caller is a member of the owning org', async () => {
    const session = makeSession({ userId: 'u1' })
    const auth = makeAuthGateway(t, session)
    const identity = makeIdentityGateway({
      u1: [{ id: 'o1', name: 'Org One', slug: 'org-one' }],
    })

    const result = await requireRestaurantAccess(auth, identity, 'r1')

    expect(result.restaurantId).toBe('r1')
    expect(result.organizationId).toBe('o1')
    expect(result.session).toBe(session)
  })

  it('redirects to /dashboard when the restaurant belongs to a different org', async () => {
    await t.db.insert(schema.restaurant).values({
      id: 'r2',
      organizationId: 'o2',
      slug: 'pizza',
      name: 'Pizza',
    })

    const session = makeSession({ userId: 'u1' })
    const auth = makeAuthGateway(t, session)
    const identity = makeIdentityGateway({
      u1: [{ id: 'o1', name: 'Org One', slug: 'org-one' }],
    })

    await expect(requireRestaurantAccess(auth, identity, 'r2')).rejects.toThrow(
      '__REDIRECT__:/dashboard',
    )
  })

  it('falls back to the first organization Zitadel returns when picking the active org', async () => {
    const session = makeSession({ userId: 'u1' })
    const auth = makeAuthGateway(t, session)
    const identity = makeIdentityGateway({
      u1: [
        { id: 'o1', name: 'Org One', slug: 'org-one' },
        { id: 'o2', name: 'Org Two', slug: 'org-two' },
      ],
    })

    const result = await requireRestaurantAccess(auth, identity, 'r1')

    expect(result.organizationId).toBe('o1')
    expect(result.restaurantId).toBe('r1')
  })

  it('redirects to /onboarding when the user has no orgs on Zitadel', async () => {
    const session = makeSession({ userId: 'u2' })
    const auth = makeAuthGateway(t, session)
    const identity = makeIdentityGateway({}) // u2 → no orgs

    await expect(requireRestaurantAccess(auth, identity, 'r1')).rejects.toThrow(
      '__REDIRECT__:/onboarding',
    )
  })
})

describe('requireIedoraAdmin', () => {
  it('redirects to /api/auth/login when there is no session', async () => {
    const gw: AuthGateway = {
      getSession: async () => null,
    } as unknown as AuthGateway

    await expect(requireIedoraAdmin(gw)).rejects.toThrow(
      '__REDIRECT__:/api/auth/login',
    )
  })

  it('returns the session when the iedora-admin role is present', async () => {
    const session = makeSession({ userId: 'u1', roles: [IEDORA_ADMIN_ROLE] })
    const gw: AuthGateway = {
      getSession: async () => session,
    } as unknown as AuthGateway

    await expect(requireIedoraAdmin(gw)).resolves.toBe(session)
  })

  it('404s when the user is signed in but lacks the role — does not advertise the surface', async () => {
    const session = makeSession({ userId: 'u1', roles: [] })
    const gw: AuthGateway = {
      getSession: async () => session,
    } as unknown as AuthGateway

    await expect(requireIedoraAdmin(gw)).rejects.toThrow('__NOT_FOUND__')
  })
})

describe('requireScope', () => {
  it('redirects to /api/auth/login when there is no session', async () => {
    const gw: AuthGateway = { getSession: async () => null } as unknown as AuthGateway

    await expect(requireScope(gw, SCOPES.QR_CODES_WRITE)).rejects.toThrow(
      '__REDIRECT__:/api/auth/login',
    )
  })

  it('returns the session when the scope is present in permissions', async () => {
    const session = makeSession({
      userId: 'u1',
      permissions: [SCOPES.QR_CODES_READ, SCOPES.QR_CODES_WRITE],
    })
    const gw: AuthGateway = { getSession: async () => session } as unknown as AuthGateway

    await expect(requireScope(gw, SCOPES.QR_CODES_WRITE)).resolves.toBe(session)
  })

  it('404s when the scope is missing — does not leak the surface', async () => {
    const session = makeSession({
      userId: 'u1',
      permissions: [SCOPES.QR_CODES_READ],
    })
    const gw: AuthGateway = { getSession: async () => session } as unknown as AuthGateway

    await expect(requireScope(gw, SCOPES.QR_CODES_DELETE)).rejects.toThrow('__NOT_FOUND__')
  })

  it('does NOT auto-derive scope from `roles` — only the permissions list counts', async () => {
    // A user with iedora-admin role but no permissions (e.g. Action
    // webhook didn't run) should NOT auto-pass. Fail closed.
    const session = makeSession({
      userId: 'u1',
      roles: [IEDORA_ADMIN_ROLE],
      permissions: [],
    })
    const gw: AuthGateway = { getSession: async () => session } as unknown as AuthGateway

    await expect(requireScope(gw, SCOPES.QR_CODES_WRITE)).rejects.toThrow('__NOT_FOUND__')
  })
})
