import 'server-only'
import type { AuthGateway } from '../ports'

/**
 * Resolves the user's effective organizationId.
 *
 * Better Auth doesn't restore `activeOrganizationId` after re-login, so on a
 * fresh session we fall back to the user's earliest membership. Returns null
 * only when the user truly has no organizations yet (onboarding case).
 */
export async function getEffectiveOrganizationId(
  auth: AuthGateway,
  userId: string,
  sessionActive: string | null | undefined,
): Promise<string | null> {
  if (sessionActive) return sessionActive
  const membership = await auth.findEarliestOrgMembership(userId)
  return membership?.organizationId ?? null
}
