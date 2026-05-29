import 'server-only'
import { redirect } from 'next/navigation'
import { signInUrl } from '@iedora/product-core/url'
import type { AuthGateway } from '../ports'

/**
 * Resolves the current session. Redirects to /sign-in when the caller is
 * unauthenticated; returns the (non-null) session otherwise.
 *
 * Backed by better-auth — the cookie is set by the @iedora/core-auth instance,
 * which scopes cookies on the parent domain (`.iedora.com`) so SSO works
 * across iedora products.
 */
export async function verifySession(auth: AuthGateway) {
  const session = await auth.getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }
  return session
}
