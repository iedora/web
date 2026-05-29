import 'server-only'
import type { AuthGateway } from '../ports'

/**
 * Resolves the org the caller is currently acting on. better-auth's
 * organization plugin stores this on `session.activeTenantId`,
 * so the lookup collapses to a single session read. Returns null when
 * no org is selected (the post-signup, pre-onboarding state) or when
 * there's no session.
 */
export async function getEffectiveOrganizationId(
  auth: AuthGateway,
): Promise<string | null> {
  const session = await auth.getSession()
  return session?.session.activeTenantId ?? null
}
