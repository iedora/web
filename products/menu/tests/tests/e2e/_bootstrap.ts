import { writeFileSync } from 'node:fs'

const port = parseInt(process.env.SHIM_PORT ?? '4444', 10)
const url = `http://127.0.0.1:${port}`

declare const Bun: {
  serve: (options: {
    port: number
    fetch: (req: Request) => Promise<Response> | Response
  }) => unknown
}

writeFileSync(
  new URL('./.testkit.json', import.meta.url),
  JSON.stringify({ url }),
)

/**
 * Zitadel mock — minimal shim that lets menu's auth + identity slices
 * resolve a user's primary org without a real Zitadel. The mappings are
 * mutable so tests can register distinct users → orgs (`POST /test/
 * user-orgs`), and the production `createOrganization` adapter writes
 * back to the same registry via the mgmt-API endpoints below.
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration              — OIDC discovery
 *   POST /v2/organizations                               — create org;
 *        binds first admin to the org. Used by identity.createOrganization.
 *   POST /v2/organizations/_search                       — returns orgs
 *        filtered by idQuery (when present) or full registry
 *   POST /zitadel.user.v2.UserService/ListUserMetadata  — primary org
 *        for a user (default: o1 if unmapped)
 *   POST /zitadel.user.v2.UserService/SetUserMetadata    — write the
 *        primary-org pointer. Used by identity.setActiveOrganization +
 *        identity.createOrganization's post-create stash.
 *   POST /test/user-orgs                                — direct
 *        {userId, organizationId} mapping. Backdoor for specs that don't
 *        want to drive the create-org flow.
 *   POST /test/reset                                    — clear registry
 *
 * Real OIDC token exchange / JWKS are NOT implemented; tests bypass the
 * code-exchange dance via `signInAs` in `@/features/auth/testing` (cookie
 * injection). Add token/JWKS endpoints when an E2E spec needs the full
 * auth-code flow (Phase 4).
 */

type Mappings = {
  userToOrg: Map<string, string>
  orgs: Map<string, { id: string; name: string; primaryDomain: string }>
}

const state: Mappings = {
  userToOrg: new Map(),
  orgs: new Map([
    ['o1', { id: 'o1', name: 'Org One', primaryDomain: 'iedora.com' }],
  ]),
}

function registerOrg(id: string, name = id, primaryDomain = `${id}.iedora.test`) {
  state.orgs.set(id, { id, name, primaryDomain })
}

function readBody(req: Request) {
  return req.json().catch(() => ({}) as Record<string, unknown>)
}

const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64')

Bun.serve({
  port,
  async fetch(req: Request) {
    const path = new URL(req.url).pathname
    if (process.env.SHIM_VERBOSE === '1') {
      console.log(`[zitadel-mock] ${req.method} ${path}`)
    }

    if (path === '/.well-known/openid-configuration') {
      return Response.json({
        issuer: url,
        authorization_endpoint: `${url}/oauth/v2/authorize`,
        token_endpoint: `${url}/oauth/v2/token`,
        userinfo_endpoint: `${url}/oauth/v2/userinfo`,
        end_session_endpoint: `${url}/oauth/v2/logout`,
        jwks_uri: `${url}/oauth/v2/keys`,
      })
    }

    if (path === '/test/user-orgs' && req.method === 'POST') {
      const body = (await readBody(req)) as { userId?: string; organizationId?: string; name?: string }
      if (!body.userId || !body.organizationId) {
        return new Response('userId + organizationId required', { status: 400 })
      }
      registerOrg(body.organizationId, body.name)
      state.userToOrg.set(body.userId, body.organizationId)
      return Response.json({ ok: true })
    }

    if (path === '/test/reset' && req.method === 'POST') {
      state.userToOrg.clear()
      state.orgs.clear()
      registerOrg('o1', 'Org One', 'iedora.com')
      return Response.json({ ok: true })
    }

    if (path === '/zitadel.user.v2.UserService/ListUserMetadata') {
      const body = (await readBody(req)) as { userId?: string }
      const orgId =
        (body.userId && state.userToOrg.get(body.userId)) ?? 'o1'
      return Response.json({
        metadata: [{ key: 'primaryOrgId', value: enc(orgId) }],
      })
    }

    if (path === '/zitadel.user.v2.UserService/SetUserMetadata') {
      const body = (await readBody(req)) as {
        userId?: string
        metadata?: Array<{ key?: string; value?: string }>
      }
      const orgEntry = body.metadata?.find((m) => m?.key === 'primaryOrgId')
      if (body.userId && orgEntry?.value) {
        // Value is base64 per Zitadel mgmt API convention.
        const decoded = Buffer.from(orgEntry.value, 'base64').toString('utf8')
        state.userToOrg.set(body.userId, decoded)
      }
      return Response.json({ details: { resourceOwner: state.userToOrg.get(body.userId ?? '') ?? null } })
    }

    if (path === '/v2/organizations' && req.method === 'POST') {
      // identity.createOrganization: creates the org and (optionally)
      // attaches admins. The production adapter then writes a metadata
      // pointer separately — we don't mirror the admin grant here (it's
      // not consulted by anything in test flows).
      const body = (await readBody(req)) as {
        name?: string
        admins?: Array<{ userId?: string; roles?: string[] }>
      }
      const id = `org_${Math.random().toString(36).slice(2, 10)}`
      const name = body.name ?? id
      registerOrg(id, name, `${id}.iedora.test`)
      const adminUser = body.admins?.[0]?.userId
      if (adminUser) state.userToOrg.set(adminUser, id)
      return Response.json({ organizationId: id })
    }

    if (path === '/v2/organizations/_search') {
      const body = (await readBody(req)) as {
        queries?: Array<{ idQuery?: { id?: string } }>
      }
      const idQuery = body.queries?.find((q) => q?.idQuery?.id)?.idQuery?.id
      const result = idQuery
        ? Array.from(state.orgs.values()).filter((o) => o.id === idQuery)
        : Array.from(state.orgs.values())
      return Response.json({ result })
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[zitadel-mock] Stub server listening on ${url}`)
