import { writeFileSync } from 'node:fs'

const port = parseInt(process.env.SHIM_PORT ?? '4444', 10)
const url = `http://127.0.0.1:${port}`

declare const Bun: {
  serve: (options: {
    port: number
    fetch: (req: Request) => Promise<Response> | Response
  }) => any
}

// Write the testkit indicator Playwright expects.
writeFileSync(
  new URL('./.testkit.json', import.meta.url),
  JSON.stringify({ url })
)

Bun.serve({
  port,
  async fetch(req: Request) {
    const path = new URL(req.url).pathname
    console.log(`[zitadel-mock] ${req.method} ${path}`)

    // 1. OIDC Discovery
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

    // 2. User Metadata list (used to find primaryOrgId)
    if (path === '/zitadel.user.v2.UserService/ListUserMetadata') {
      const body = await req.json().catch(() => ({}))
      console.log(`[zitadel-mock] ListUserMetadata for:`, body)
      return Response.json({
        metadata: [
          {
            key: 'primaryOrgId',
            value: Buffer.from('o1', 'utf8').toString('base64'),
          },
        ],
      })
    }

    // 3. Organization Search
    if (path === '/v2/organizations/_search') {
      const body = await req.json().catch(() => ({}))
      console.log(`[zitadel-mock] _search organizations:`, body)
      return Response.json({
        result: [
          {
            id: 'o1',
            name: 'Org One',
            primaryDomain: 'iedora.com',
          },
        ],
      })
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[zitadel-mock] Stub server listening on ${url}`)
