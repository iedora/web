import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { account } from '@/shared/db/schema'
import { env } from '@/shared/env'
import type { IdentityGateway, Organization } from '../ports'

/**
 * Production IdentityGateway. Calls Genkan's HTTP identity API on the
 * user's behalf, using the OAuth access token Better Auth stored in the
 * local `account` row when the user completed the OIDC callback.
 *
 * Routes live under `/api/identity/organization/*` (NOT
 * `/api/auth/organization/*` — those are Better Auth's organization plugin
 * endpoints, which gate on session cookies and reject bearer tokens).
 * Genkan's `/api/identity/*` routes authenticate the bearer via the local
 * JWKS / opaque-token table and re-issue the call as the verified user.
 *
 * Errors are coerced to friendly return values (null / empty list / false)
 * because the call sites are server actions and page DAL guards — they
 * already branch on missing data. We log unexpected failures so they show
 * up in the container logs.
 */
async function getAccessToken(userId: string): Promise<string | null> {
  const rows = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'genkan')))
    .limit(1)
  return rows[0]?.accessToken ?? null
}

type GenkanOrg = {
  id: string
  name: string
  slug: string
}

function normalize(raw: GenkanOrg): Organization {
  return { id: raw.id, name: raw.name, slug: raw.slug }
}

async function callGenkan<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await getAccessToken(userId)
  if (!token) {
    console.warn(`[identity] no access token for user ${userId}`)
    return null
  }
  const url = `${env.GENKAN_ISSUER_URL}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      // Identity calls are user-scoped and short-lived; no Next caching.
      cache: 'no-store',
    })
  } catch (err) {
    console.error(`[identity] ${init.method ?? 'GET'} ${url} threw`, err)
    return null
  }
  if (!res.ok) {
    console.error(
      `[identity] ${init.method ?? 'GET'} ${url} → ${res.status}`,
      await res.text().catch(() => ''),
    )
    return null
  }
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export const genkanHttpIdentity: IdentityGateway = {
  async listOrganizations(userId) {
    const raw = await callGenkan<GenkanOrg[]>(
      userId,
      '/api/identity/organization/list',
    )
    if (!Array.isArray(raw)) return []
    return raw.map(normalize)
  },

  async createOrganization(userId, name, slug) {
    const raw = await callGenkan<GenkanOrg>(
      userId,
      '/api/identity/organization/create',
      {
        method: 'POST',
        body: JSON.stringify({ name, slug }),
      },
    )
    return raw ? normalize(raw) : null
  },

  async setActiveOrganization(userId, organizationId) {
    const raw = await callGenkan<unknown>(
      userId,
      '/api/identity/organization/set-active',
      {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      },
    )
    return raw !== null
  },
}
