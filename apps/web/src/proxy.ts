import { NextRequest, NextResponse } from 'next/server'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { signInUrl } from '@iedora/product-core/url'
import { surfaces, surfaceByHost } from './generated/surfaces'

const protectedPrefixes = ['/menu/dashboard', '/menu/onboarding']

/**
 * better-auth's session cookie names. Used here only as an OPTIMISTIC
 * hint (cookie present ⇒ likely signed in) — the real session lookup
 * happens in the DAL via `auth.api.getSession()`. AGENTS.md hard rule #5.
 *
 * Two variants because better-auth auto-prepends `__Secure-` when the
 * origin is HTTPS (prod). Checking only the bare name produced a real
 * loop: optimistic check said "no session" on a signed-in request →
 * redirect to sign-in → sign-in's server-side `auth.api.getSession()`
 * sees the cookie → redirects back → loop.
 */
const SESSION_COOKIES = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
] as const

/**
 * Three jobs in order of precedence:
 *
 *   1. **Host-based rewrites** — for hosts whose surface has a
 *      `rewritePath` (e.g. `iedora.com → /house/*`, `core.iedora.com
 *      → /core/*`). The matched surface comes from the hand-maintained
 *      registry at `./generated/surfaces.ts`.
 *
 *   2. **Cross-host guard** for namespace paths. Direct visits to
 *      another surface's namespace (`menu.iedora.com/house*`,
 *      `menu.iedora.com/core/*`) 404 — except `localhost` where every
 *      surface keeps its path-based fallback for plain local dev
 *      without `*.localhost` gymnastics.
 *
 *   3. **Optimistic auth gate** for menu's protected prefixes. Real
 *      auth runs in the DAL via `verifySession()`.
 */
export default function proxy(req: NextRequest) {
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
  // Why it matters: server-side `redirect('/menu/onboarding')` calls
  // (in app pages + menu's auth use-cases) emit the INTERNAL Next path
  // as the browser-visible Location header. The browser then visits
  // `menu.iedora.com/menu/onboarding`, and without idempotence the
  // proxy turned it into `/menu/menu/onboarding` → 404. Now both
  // `menu.iedora.com/onboarding` and `menu.iedora.com/menu/onboarding`
  // resolve to the same internal `/menu/onboarding` route.
  //
  // Note: when the path is already prefixed we DON'T early-return —
  // we just skip the rewrite. Rules 2 (cross-host guard) and 3 (auth
  // gate) still need to evaluate for `/menu/dashboard` direct visits.
  if (here && here.rewritePath) {
    const alreadyPrefixed =
      path === here.rewritePath || path.startsWith(`${here.rewritePath}/`)
    if (!alreadyPrefixed) {
      const target = path === '/' ? here.rewritePath : `${here.rewritePath}${path}`
      const url = req.nextUrl.clone()
      url.pathname = target
      return NextResponse.rewrite(url)
    }
  }

  // 1b. Plain-localhost alias fallback — surfaces may declare
  //     `aliasPaths` (top-level URL segments their slices emit without
  //     the rewritePath prefix, because they run under a subdomain in
  //     prod and rely on rule 1 to add the prefix). On bare `localhost`
  //     no surface matches, so without this branch those paths 404.
  //     Subdomain hosts (`menu.localhost`, `core.localhost`, …) go
  //     through rule 1 above and never reach here.
  if (!here && host === 'localhost') {
    for (const s of surfaces) {
      if (!s.rewritePath || !s.aliasPaths?.length) continue
      const match = s.aliasPaths.some(
        (p) => path === p || path.startsWith(`${p}/`),
      )
      if (!match) continue
      const url = req.nextUrl.clone()
      url.pathname = `${s.rewritePath}${path}`
      return NextResponse.rewrite(url)
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

  // 3. Menu's optimistic auth check.
  const isProtected = protectedPrefixes.some((p) => path.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name))
  if (!hasSession) {
    // Cross-origin redirect to the core product's sign-in. `next` is an
    // absolute URL on THIS host (built via publicUrl) so after auth the
    // user lands back on the protected route they tried to reach.
    return NextResponse.redirect(signInUrl(publicUrl(path).toString()))
  }

  return NextResponse.next()
}

export const config = {
  // `up` is excluded alongside `api` — both serve every host without
  // rewrite (infra plumbing: better-auth catch-all + container
  // healthcheck). Routes for them live at apps/web/src/app/{api,up}/.
  matcher: ['/((?!api|up|_next/static|_next/image|.*\\.png$).*)'],
}
