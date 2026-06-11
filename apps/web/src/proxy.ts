import { NextRequest, NextResponse } from 'next/server'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { signInUrl } from '@iedora/product-menu/shared/auth-urls'
import { resolveAuth, applyCookies } from '@iedora/api-client/middleware'
import { surfaces, surfaceByHost } from './generated/surfaces'

const protectedPrefixes = ['/menu/dashboard', '/menu/onboarding']

/**
 * Three jobs in order of precedence:
 *
 *   1. **Host-based rewrites** — for hosts whose surface has a
 *      `rewritePath` (e.g. `iedora.com → /house/*`, `menu.iedora.com
 *      → /menu/*`). The matched surface comes from the hand-maintained
 *      registry at `./generated/surfaces.ts`.
 *
 *   2. **Cross-host guard** for namespace paths. Direct visits to
 *      another surface's namespace (`menu.iedora.com/house*`)
 *      404 — except `localhost` where every
 *      surface keeps its path-based fallback for plain local dev
 *      without `*.localhost` gymnastics.
 *
 *   3. **Auth gate + token refresh** for menu's protected prefixes.
 *      This middleware is the ONE place that refreshes an expired
 *      access token for page loads: RSCs can't mutate cookies, so the
 *      refresh happens here and the request's Cookie header is
 *      rewritten so downstream server components always read a valid
 *      `iedora_access` cookie. Authorization proper stays with the Go
 *      services — every API call is verified there.
 */
export default async function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0] ?? ''
  const path = req.nextUrl.pathname

  const here = surfaceByHost(host)

  // 1. Host-based rewrite for surfaces with a rewritePath set.
  //
  // The rewrite is **idempotent**: if the path already starts with the
  // surface's `rewritePath` (e.g. `menu.iedora.com/menu/onboarding`),
  // we don't prepend again. Double-prefixing produced URLs that 404'd
  // in prod even though the same internal route worked.
  //
  // The rewrite target is computed here but the response is built at
  // the END, so the auth gate below also covers rewritten paths
  // (`menu.iedora.com/dashboard` → internal `/menu/dashboard`).
  let internalPath = path
  let rewrite = false
  if (here && here.rewritePath) {
    const alreadyPrefixed =
      path === here.rewritePath || path.startsWith(`${here.rewritePath}/`)
    if (!alreadyPrefixed) {
      internalPath = path === '/' ? here.rewritePath : `${here.rewritePath}${path}`
      rewrite = true
    }
  }

  // 1b. Plain-localhost alias fallback — surfaces may declare
  //     `aliasPaths` (top-level URL segments their slices emit without
  //     the rewritePath prefix, because they run under a subdomain in
  //     prod and rely on rule 1 to add the prefix). On bare `localhost`
  //     no surface matches, so without this branch those paths 404.
  //     Subdomain hosts (`menu.localhost`, …) go
  //     through rule 1 above and never reach here.
  if (!here && host === 'localhost') {
    for (const s of surfaces) {
      if (!s.rewritePath || !s.aliasPaths?.length) continue
      const match = s.aliasPaths.some(
        (p) => path === p || path.startsWith(`${p}/`),
      )
      if (!match) continue
      internalPath = `${s.rewritePath}${path}`
      rewrite = true
      break
    }
  }

  // 2. Cross-host guard — visiting another surface's namespace from
  //    a host that doesn't own it. `localhost` (the dev catch-all)
  //    keeps the path-based fallback so every surface's /<name>/*
  //    works without `*.localhost` /etc/hosts gymnastics.
  for (const s of surfaces) {
    if (!s.rewritePath) continue
    if (here && here.name === s.name) continue
    if (path !== s.rewritePath && !path.startsWith(`${s.rewritePath}/`)) continue
    if (host === 'localhost') continue
    return new NextResponse('Not Found', { status: 404 })
  }

  // 3. Auth gate on the INTERNAL path (covers rewritten visits too).
  const isProtected = protectedPrefixes.some((p) => internalPath.startsWith(p))
  if (!isProtected) {
    return respond(req, internalPath, rewrite)
  }

  const auth = await resolveAuth(req)
  if (!auth.session) {
    // Redirect to the menu surface's sign-in. `next` is an
    // absolute URL on THIS host (built via publicUrl) so after auth the
    // user lands back on the protected route they tried to reach.
    const res = NextResponse.redirect(signInUrl(publicUrl(path).toString()))
    return applyCookies(res, auth.cookieWrites) // clears dead cookies
  }

  const res = respond(req, internalPath, rewrite, auth.requestHeaders)
  return applyCookies(res, auth.cookieWrites)
}

/** Builds the pass-through/rewrite response, optionally swapping the
 *  request headers (used to forward a just-refreshed access cookie). */
function respond(
  req: NextRequest,
  internalPath: string,
  rewrite: boolean,
  requestHeaders?: Headers,
): NextResponse {
  const request = requestHeaders ? { headers: requestHeaders } : undefined
  if (!rewrite) return NextResponse.next({ request })
  const url = req.nextUrl.clone()
  url.pathname = internalPath
  return NextResponse.rewrite(url, { request })
}

export const config = {
  // `up` and `track` are excluded alongside `api` — they serve every
  // host without rewrite (infra plumbing: container healthcheck + the
  // public-menu view beacon, which next.config.ts rewrites straight to
  // the Go menu service).
  matcher: ['/((?!api|up|track|_next/static|_next/image|.*\\.png$).*)'],
}
