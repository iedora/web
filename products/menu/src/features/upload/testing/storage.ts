import 'server-only'

/**
 * Upload-slice helpers built on top of `@/shared/testing/e2e-storage`.
 * The shared module knows the bucket; this module adds the menu-specific
 * key convention (`r/{restaurantId}/...`) so specs don't reinvent it.
 *
 * Direct-S3 helpers exist alongside the production presign / commit flow
 * — use them for fixture setup (pre-place an object so a delete flow has
 * something to delete) or post-flow verification (object exists after a
 * UI upload).
 */

import {
  putObject,
  objectExists,
  deleteObject,
} from '@/shared/testing/e2e-storage'

export { putObject, objectExists, deleteObject }

/**
 * Build a tenant-prefixed key matching the upload-slice convention
 * (CLAUDE.md rule 9). Use this so spec code never hand-rolls the prefix.
 */
export function tenantKey(restaurantId: string, suffix: string): string {
  const trimmed = suffix.replace(/^\/+/, '')
  return `r/${restaurantId}/${trimmed}`
}
