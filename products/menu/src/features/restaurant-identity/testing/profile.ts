import type { PermissionProfile } from '@/features/auth/testing'

/**
 * Restaurant-identity gates by tenant membership, not by atomic scopes
 * (current model). Profile is "authenticated member of the org that owns
 * the restaurant" — adopt the bare profile here and rely on
 * `signInAs({ organizationId })` to match the seed's org.
 */
export const restaurantOwnerProfile: PermissionProfile = {
  roles: [],
  permissions: [],
}
