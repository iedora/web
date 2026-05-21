/**
 * Canonical permission scopes asserted on the iedora-staff surface. Used
 * by `requireScope` (in `@/features/auth`) and by the Zitadel Action
 * webhook that expands bundles into the `permissions` claim.
 *
 * Atomic permissions follow the OAuth scope convention `resource:verb`.
 * Bundles (e.g. `iedora-admin`) live in `bundles.ts` and resolve to a
 * subset of these scopes.
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

/**
 * Every scope value, used by the webhook to validate that a role with a
 * colon is a known atomic permission before passing it through.
 */
export const ALL_SCOPES: ReadonlyArray<Scope> = Object.values(SCOPES)
