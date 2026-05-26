import 'server-only'

/**
 * Public test surface of the auth slice. Importable only from
 * `src/features/&#42;/e2e/` and `tests/e2e/journeys/` (rule 15).
 *
 * The `signInAs` / `signOut` helpers that fabricated JWE cookies for the
 * Zitadel-era integration were dropped with the better-auth cutover.
 * E2E specs that need a signed-in user will land alongside the new
 * sign-in/sign-up UI; for now this barrel exports only the static
 * permission profiles + the auth route table.
 */

export { iedoraAdminProfile, memberProfile } from './profile'
export type { PermissionProfile } from './profile'
export { authRoutes } from './routes'
