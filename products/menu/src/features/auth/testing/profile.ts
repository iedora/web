import { ALL_SCOPES, type Scope } from '../scopes'
import { IEDORA_ADMIN_ROLE } from '../roles'

/**
 * A permission profile a test grants its signed-in user. Specs declare
 * intent ("this user is an iedora-admin", "this user is a plain member")
 * instead of stamping role/scope strings inline — that way new scopes
 * added to `../scopes.ts` lift every spec that uses the relevant profile
 * with zero test edits.
 */
export type PermissionProfile = {
  readonly roles: readonly string[]
  readonly permissions: readonly Scope[]
}

/**
 * Full Iedora-staff access. Mirrors the production bundle expansion in
 * `../bundles.ts`: the `iedora-admin` role resolves to every scope in
 * `ALL_SCOPES`. Use for QR-code admin specs and anything else gated by
 * `requireIedoraAdmin`.
 */
export const iedoraAdminProfile: PermissionProfile = {
  roles: [IEDORA_ADMIN_ROLE],
  permissions: ALL_SCOPES,
}

/**
 * Authenticated but unprivileged — no roles, no scopes. Use this when a
 * spec needs a session present (so the DAL does not bounce to /api/auth/
 * login) but wants to assert that scope-gated actions are denied.
 */
export const memberProfile: PermissionProfile = {
  roles: [],
  permissions: [],
}
