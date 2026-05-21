// Test env BEFORE importing the adapter (env.ts parses on import).
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test'
process.env.MENU_PUBLIC_URL ||= 'http://localhost:3000'
process.env.MENU_SESSION_SECRET ||= 'a'.repeat(48)
process.env.ZITADEL_ISSUER_URL ||= 'https://auth.test.local'
process.env.ZITADEL_OAUTH_CLIENT_ID ||= 'menu-test'
process.env.ZITADEL_OAUTH_CLIENT_SECRET ||= 'test-secret'
process.env.ZITADEL_MANAGEMENT_TOKEN ||= 'test-pat'
process.env.ZITADEL_ACTION_SIGNING_KEY ||= 'test-signing-key'
process.env.S3_ENDPOINT ||= 'http://localhost:4566'
process.env.S3_REGION ||= 'us-east-1'
process.env.S3_ACCESS_KEY ||= 'test'
process.env.S3_SECRET_KEY ||= 'test'
process.env.S3_BUCKET ||= 'test'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { zitadelHttpIdentity } = await import('./zitadel-http')

type FetchCall = { url: string; init: RequestInit }

const calls: FetchCall[] = []
let nextResponses: Response[] = []

beforeEach(() => {
  calls.length = 0
  nextResponses = []
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: url.toString(), init })
    const r = nextResponses.shift()
    if (!r) throw new Error(`unexpected fetch to ${url}`)
    return r
  }) as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('zitadelHttpIdentity.listOrganizations', () => {
  it('POSTs the v2 memberships search with the menu-sa bearer and maps org rows', async () => {
    nextResponses.push(
      jsonRes({
        details: { totalResult: '2' },
        result: [
          { orgId: 'org-1', orgName: 'House Tavern' },
          // IAM-level row — must be filtered out (no orgId).
          { iam: { name: 'IAM' } },
          { orgId: 'org-2', orgName: 'Pizza Cosmica' },
        ],
      }),
    )

    const orgs = await zitadelHttpIdentity.listOrganizations('u-7')

    expect(orgs).toEqual([
      { id: 'org-1', name: 'House Tavern', slug: 'house-tavern' },
      { id: 'org-2', name: 'Pizza Cosmica', slug: 'pizza-cosmica' },
    ])
    const call = calls[0]!
    expect(call.url).toBe('https://auth.test.local/v2/users/u-7/memberships/_search')
    expect(call.init.method).toBe('POST')
    const headers = new Headers(call.init.headers)
    expect(headers.get('authorization')).toBe('Bearer test-pat')
  })

  it('returns an empty list on a non-2xx response', async () => {
    nextResponses.push(new Response('nope', { status: 500 }))
    expect(await zitadelHttpIdentity.listOrganizations('u-7')).toEqual([])
  })

  it('returns an empty list when fetch throws (network/DNS)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect(await zitadelHttpIdentity.listOrganizations('u-7')).toEqual([])
  })
})

describe('zitadelHttpIdentity.createOrganization', () => {
  it('creates the org, then adds the user as ORG_OWNER, then returns it', async () => {
    nextResponses.push(jsonRes({ id: 'org-new' }))
    nextResponses.push(jsonRes({ details: {} }))

    const result = await zitadelHttpIdentity.createOrganization(
      'u-7',
      'Café Apex',
      'cafe-apex',
    )

    expect(result).toEqual({ id: 'org-new', name: 'Café Apex', slug: 'cafe-apex' })
    expect(calls).toHaveLength(2)

    const create = calls[0]!
    expect(create.url).toBe('https://auth.test.local/admin/v1/orgs')
    expect(create.init.method).toBe('POST')
    expect(JSON.parse(create.init.body as string)).toEqual({ name: 'Café Apex' })

    const member = calls[1]!
    expect(member.url).toBe('https://auth.test.local/management/v1/orgs/org-new/members')
    expect(member.init.method).toBe('POST')
    expect(new Headers(member.init.headers).get('x-zitadel-orgid')).toBe('org-new')
    expect(JSON.parse(member.init.body as string)).toEqual({
      userId: 'u-7',
      roles: ['ORG_OWNER'],
    })
  })

  it('returns null when org creation itself fails', async () => {
    nextResponses.push(new Response('{}', { status: 409 }))
    expect(await zitadelHttpIdentity.createOrganization('u-7', 'X', 'x')).toBeNull()
    expect(calls).toHaveLength(1) // never calls members endpoint
  })

  it('still returns the org when add-member fails (orphan-empty-org is the lesser evil)', async () => {
    nextResponses.push(jsonRes({ id: 'org-new' }))
    nextResponses.push(new Response('{}', { status: 500 }))

    const result = await zitadelHttpIdentity.createOrganization('u-7', 'X', 'x')
    expect(result).toEqual({ id: 'org-new', name: 'X', slug: 'x' })
  })
})

describe('zitadelHttpIdentity.setActiveOrganization', () => {
  it('is a no-op that returns true (Zitadel does not model an active org)', async () => {
    // No fetch responses queued — proves it never calls out.
    expect(
      await zitadelHttpIdentity.setActiveOrganization('u-7', 'org-1'),
    ).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
