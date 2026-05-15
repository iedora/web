import 'server-only'
import { redirect } from 'next/navigation'
import type { AuthGateway } from '../ports'

/**
 * Resolves the current session. Redirects to /login when unauthenticated;
 * returns the (non-null) session otherwise.
 */
export async function verifySession(auth: AuthGateway) {
  const session = await auth.getSession()
  if (!session?.user) redirect('/login')
  return session
}
