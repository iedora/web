import type { PermissionProfile } from '@/features/auth/testing'

/** Public menu is unauthenticated. Profile here is a placeholder for symmetry. */
export const publicVisitorProfile: PermissionProfile = {
  roles: [],
  permissions: [],
}
