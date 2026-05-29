/**
 * @iedora/core-auth — public API.
 *
 * Server entry. Browser code imports from `@iedora/core-auth/client` instead
 * (the `better-auth/react` client lives there). The role-preset layer
 * (`STAFF_ROLE_PRESETS`, `TENANT_ROLE_PRESETS`, role literals) is also
 * re-exported here for convenience; deep import `@iedora/core-auth/role-presets`
 * for the same surface without pulling the server-only modules.
 */

export { getAuth, auth } from './auth'
export type { Auth, AuthSession } from './auth'

// Role presets + literals (UX shortcuts derived from `./scopes::SCOPES` —
// the only source of truth for the scope catalogue).
export {
  STAFF_ROLES,
  IEDORA_ADMIN_ROLE,
  IEDORA_SUPPORT_ROLE,
  STAFF_ROLE_PRESETS,
  TENANT_ROLE_PRESETS,
  TENANT_ROLE_PRESET_KEYS,
  detectStaffPreset,
  detectTenantPreset,
  isStaffRole,
  type StaffRoleKey,
  type TenantRolePresetKey,
} from './role-presets'

export { schema } from './schema'
export { getCoreDb } from './db'

export { recordAudit } from './audit'
export type { AuditInput, AuditOutcome } from './audit'
export {
  CORE_AUDIT_EVENTS,
  type CoreAuditEvent,
  type AuditActor,
} from './audit-events'

// Tenancy primitives (cross-product). Replace the former better-auth
// `organization` plugin surface.
export {
  createTenant,
  getTenantById,
  listUserTenants,
  hasAnyTenant,
  type Tenant,
} from './tenants'
export {
  upsertMember,
  removeMember,
  listMembers,
  getMemberScopes,
  type TenantMember,
} from './tenant-members'
export {
  getActiveTenantId,
  setActiveTenant,
} from './sessions'

// Staff (cross-tenant) primitives. Replace the former better-auth
// `admin` plugin surface — ban / impersonate / list-users live here
// now, working over the schema columns better-auth had configured.
export {
  getUserScopes,
  setUserScopes,
  userHasScope,
  isStaffUser,
  banUser,
  unbanUser,
  isBanned,
  impersonateUser,
  stopImpersonating,
  listUsers,
  getUser,
  type UserRow,
  type ListUsersFilter,
  type ListUsersResult,
} from './staff'
