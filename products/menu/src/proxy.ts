import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/features/auth/adapters/session'
import { publicUrl } from '@/shared/url'

const protectedPrefixes = ['/dashboard', '/onboarding']

/**
 * Optimistic cookie-presence check (AGENTS.md hard rule #5). The real auth
 * gate runs in the DAL — this only avoids a wasted RSC render when the
 * caller obviously isn't signed in.
 *
 * Redirect target is `/api/auth/login?next=…` — a server-side handler on
 * menu's OWN host that mints the PKCE+state cookies and 302s the browser
 * to Zitadel. Going direct to Zitadel from here would skip the hand-off
 * and lose the post-callback `next` path.
 *
 * URL build goes through `publicUrl()` (see `@/shared/url`) — NOT
 * `req.nextUrl.clone()`. The clone would carry the upstream bind
 * (`http://0.0.0.0:3000`) into the Location header and the browser
 * would refuse to follow it.
 */
export default function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const isProtected = protectedPrefixes.some((p) => path.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const hasSession = req.cookies.has(SESSION_COOKIE)
  if (!hasSession) {
    return NextResponse.redirect(publicUrl('/api/auth/login', { next: path }))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
}
