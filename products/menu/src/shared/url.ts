import 'server-only'
import { env } from './env'

/**
 * Output-side URL hygiene — builds an absolute URL anchored at the
 * public origin. Every redirect on the server MUST go through here;
 * otherwise the URL inherits Next's internal bind
 * (`HOSTNAME=0.0.0.0 PORT=3000` from the runner stage of
 * `apps/web/Dockerfile`) and produces Location headers the
 * browser can't follow (`http://0.0.0.0:3000/r/<slug>`).
 *
 * Pure URL hygiene (path validation, no env) lives in
 * `@iedora/brand`. The split exists so pure helpers can be
 * unit-tested without env validation running.
 *
 * `req.url`, `req.nextUrl.origin`, `req.headers.get('host')` are not
 * usable for building URLs in this product — they reflect the
 * upstream Next process, not the public hostname. Adding a new
 * redirect? Reach for `publicUrl()` first; reach for `req.nextUrl`
 * only if you genuinely want the request path (passed AS A PATH to
 * `publicUrl(req.nextUrl.pathname, …)`).
 */

/**
 * Build an absolute URL anchored at MENU_PUBLIC_URL.
 *
 * Rejects absolute or protocol-relative inputs as a defence — callers
 * that want to redirect off-host (e.g. to `core.iedora.com`) pass
 * the upstream URL directly to `NextResponse.redirect` or use the
 * `signInUrl()`/`signOutUrl()` helpers from `@iedora/brand`; this
 * helper is for OUR origin only.
 */
export function publicUrl(
  path: string,
  searchParams?:
    | Record<string, string | number | undefined | null>
    | URLSearchParams,
): URL {
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(path) || path.startsWith('//')) {
    throw new Error(
      `publicUrl: absolute path rejected — pass a path like "/r/<slug>". Hit: ${path}`,
    )
  }
  const url = new URL(
    path.startsWith('/') ? path : `/${path}`,
    env.MENU_PUBLIC_URL,
  )
  if (searchParams) {
    const entries =
      searchParams instanceof URLSearchParams
        ? Array.from(searchParams.entries())
        : Object.entries(searchParams)
    for (const [k, v] of entries) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }
  return url
}

// Consumers needing isSameOriginPath import from @iedora/brand directly.

