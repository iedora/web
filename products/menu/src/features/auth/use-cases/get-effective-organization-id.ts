import 'server-only'
import type { AuthGateway } from '../ports'

/**
 * Resolves the org the caller is currently acting on. better-auth's
 * organization plugin stores this on `session.activeOrganizationId`,
 * so the lookup collapses to a single session read.
 *
 * The legacy signature accepted `(identity, userId)` and fell back to
 * the user's first membership when no active org was set; the better-auth
 * model puts that fallback on `setActiveOrganization` instead — once an
 * org is chosen, it sticks on the session row.
 */
export async function getEffectiveOrganizationId(
  auth: AuthGateway,
): Promise<string | null> {
  const session = await auth.getSession()
  return session?.session.activeOrganizationId ?? null
}
