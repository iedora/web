import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

const protectedPrefixes = ['/dashboard', '/onboarding']

export default function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const isProtected = protectedPrefixes.some((p) => path.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const sessionCookie = getSessionCookie(req)
  if (!sessionCookie) {
    const url = new URL('/login', req.nextUrl)
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
}
