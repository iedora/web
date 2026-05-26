/**
 * Canonical permission scopes asserted on the iedora-staff surface.
 *
 * Each scope is a `resource:verb` string — same convention as before the
 * better-auth cutover. Internally `scopeToPermission` translates the
 * kebab-case resource into the camelCase key expected by `@iedora/auth`'s
 * access-control taxonomy (`statement` in `@iedora/auth/permissions`).
 *
 * Framework-free — imported from RSC, route handlers, tests. MUST NOT
 * depend on `next` or `server-only`.
 */

export const SCOPES = {
  QR_CODES_READ: 'qr-codes:read',
  QR_CODES_WRITE: 'qr-codes:write',
  QR_CODES_UPDATE: 'qr-codes:update',
  QR_CODES_DELETE: 'qr-codes:delete',
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]

export const ALL_SCOPES: ReadonlyArray<Scope> = Object.values(SCOPES)

/**
 * Convert a `resource:verb` scope string into the better-auth permission
 * shape (`{ resource: ['verb'] }`). Kebab-case resources collapse to
 * camelCase to match the @iedora/auth statement key names.
 */
export function scopeToPermission(scope: Scope): Record<string, string[]> {
  const [resource, action] = scope.split(':')
  if (!resource || !action) {
    throw new Error(`[auth/scopes] malformed scope ${scope}`)
  }
  const camel = resource.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  return { [camel]: [action] }
}
