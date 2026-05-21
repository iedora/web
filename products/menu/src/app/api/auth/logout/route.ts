import { NextRequest, NextResponse } from 'next/server'
import { buildEndSessionUrl } from '@/features/auth/adapters/oidc'
import {
  makeSessionCookie,
  SESSION_COOKIE,
} from '@/features/auth/adapters/session'
import { revokeSession } from '@/features/sessions'
import { env } from '@/shared/env'

/**
 * `POST /api/auth/logout` — revokes the server-side session row, clears
 * menu's cookie, and bounces to Zitadel's end-session endpoint (which
 * drops the Zitadel-side session and redirects back to `/`).
 *
 * Revoking the row matters even though we also delete the cookie: if a
 * snapshot of the cookie was captured elsewhere (browser extension,
 * leaked log), the bearer is now useless — the next `get()` returns
 * null and the DAL bounces it through OIDC.
 *
 * GET also accepted to keep `<Link>`-based logout buttons trivial — the
 * form-encoded POST is the secure path, but GET-with-CSRF-token is a
 * pre-customer scope concern. Re-tighten if needed.
 */
const sessions = makeSessionCookie(env.MENU_SESSION_SECRET)

async function handle(req: NextRequest): Promise<Response> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value
  if (cookie) {
    const pointer = await sessions.open(cookie)
    if (pointer) {
      // Best-effort revoke — never block logout on a DB hiccup. The
      // cookie is dropped below either way, so the worst case is a
      // dangling row that expires naturally.
      try {
        await revokeSession(pointer.sid, 'logout')
      } catch (err) {
        console.error('[auth/logout] revoke failed', err)
      }
    }
  }

  const postLogout = `${env.MENU_PUBLIC_URL}/`
  const end = buildEndSessionUrl({ postLogoutRedirectUri: postLogout })
  const res = NextResponse.redirect(end, { status: 302 })
  res.cookies.delete({ name: SESSION_COOKIE, path: '/' })
  return res
}

export const GET = handle
export const POST = handle
