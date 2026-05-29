/**
 * Role-preset layer — UX shortcuts that derive bundled scope arrays
 * from the single source of truth in `./scopes::SCOPES`.
 *
 * A "role" in iedora is NOT a primitive — it's a *named bundle of
 * scopes*. Authorisation never asks "what role does this user have";
 * it asks "does the caller hold this scope". Roles only exist so an
 * admin clicking "Owner" in a UI doesn't have to tick fifteen
 * checkboxes. Detect them via `detectStaffPreset` / `detectTenantPreset`
 * for UI labels; ignore them in policy code.
 *
 * Two flavours:
 *
 *   - Staff presets — applied to `core.user.scopes` (cross-tenant).
 *     Two keys today: `iedora-admin` (wildcards every `staff:*`) and
 *     `iedora-support` (curated subset). Add `iedora-auditor` etc. by
 *     adding one entry here.
 *   - Tenant presets — applied to `core.tenant_member.scopes`
 *     (per-tenant). `owner`, `admin`, `member`, `viewer`. Picked from
 *     a dropdown in the UI; bespoke scope arrays bypass these
 *     entirely (e.g. "Mario can publish to idealista, nothing else").
 *
 * No `statement` / no `createAccessControl` here — better-auth's
 * `organization` + `admin` plugins were dropped in the tenancy
 * refactor; runtime authorisation reads `tenant_member.scopes` /
 * `user.scopes` directly via `userHasScope` and `hasScope` in
 * `./server`. This file is consumed BY those primitives, never the
 * other way around.
 *
 * Framework-free. No `server-only`, no env, no Next imports. Safe
 * for client AND server.
 */

import { SCOPES, ALL_SCOPES, type Scope } from './scopes'

// ─── Role literal constants (single source of truth for staff IDs) ──

/**
 * Cross-tenant staff role literals — the two preset keys recognised
 * across iedora. Every callsite that compares a value against
 * `'iedora-admin'` / `'iedora-support'` imports these — no inline
 * string literals.
 */
export const IEDORA_ADMIN_ROLE = 'iedora-admin' as const
export const IEDORA_SUPPORT_ROLE = 'iedora-support' as const
export const STAFF_ROLES = [IEDORA_ADMIN_ROLE, IEDORA_SUPPORT_ROLE] as const
export type StaffRoleKey = (typeof STAFF_ROLES)[number]

// ─── Presets — UX shortcuts that expand to scope arrays ─────────────

const STAFF_PREFIX = 'staff:'
const TENANT_PREFIX = 'tenant:'

/**
 * Staff role presets — applied to `user.scopes` (text[] column).
 * Adding a new staff role like `'iedora-auditor'` = one entry here,
 * nothing else changes. `'iedora-admin'` wildcards every staff scope
 * automatically via `ALL_SCOPES.filter` so new scopes are covered
 * with zero drift.
 */
export const STAFF_ROLE_PRESETS = {
  [IEDORA_ADMIN_ROLE]: ALL_SCOPES.filter((s) => s.startsWith(STAFF_PREFIX)),
  [IEDORA_SUPPORT_ROLE]: [
    SCOPES.core.staff.admin.read,
    SCOPES.core.staff.users.read,
    SCOPES.core.staff.users.ban,
    // Tenant visibility for support troubleshooting; cannot delete
    // tenants (that's admin-only).
    SCOPES.core.staff.tenants.list,
    SCOPES.core.staff.tenants.get,
    // Can kick a stuck member but cannot rewrite their scopes
    // (escalation blast — admin-only).
    SCOPES.core.staff.members.remove,
    SCOPES.core.staff.sessions.list,
    SCOPES.core.staff.sessions.revoke,
  ],
} as const satisfies Record<StaffRoleKey, readonly Scope[]>

/**
 * Tenant role presets — applied to `tenant_member.scopes` when a UI
 * picker chooses "Owner" / "Admin" / "Member" / "Viewer". The custom
 * grant case (e.g. Mario-only-idealista) skips presets and writes a
 * bespoke array directly.
 */
export const TENANT_ROLE_PRESETS = {
  owner: ALL_SCOPES.filter((s) => s.startsWith(TENANT_PREFIX)),
  admin: ALL_SCOPES.filter(
    (s) => s.startsWith(TENANT_PREFIX) && s !== SCOPES.core.tenant.tenant.delete,
  ),
  member: [
    SCOPES.menu.tenant.restaurants.read,
    SCOPES.menu.tenant.restaurants.create,
    SCOPES.menu.tenant.restaurants.update,
    SCOPES.menu.tenant.qrCodes.read,
    SCOPES.menu.tenant.qrCodes.create,
    SCOPES.menu.tenant.qrCodes.update,
    SCOPES.imopush.tenant.properties.read,
    SCOPES.imopush.tenant.properties.create,
    SCOPES.imopush.tenant.properties.update,
    SCOPES.core.tenant.members.read,
    SCOPES.core.tenant.billing.read,
  ],
  viewer: ALL_SCOPES.filter(
    (s) => s.startsWith(TENANT_PREFIX) && s.endsWith(':read'),
  ),
} as const satisfies Record<string, readonly Scope[]>

export type TenantRolePresetKey = keyof typeof TENANT_ROLE_PRESETS
export const TENANT_ROLE_PRESET_KEYS = Object.keys(
  TENANT_ROLE_PRESETS,
) as readonly TenantRolePresetKey[]

// ─── Preset detection helpers (for UI labels) ───────────────────────

function setsEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  const sb = new Set(b as readonly T[])
  return a.every((x) => sb.has(x))
}

/**
 * Reverse-lookup the staff role from a scope set. Returns `null`
 * when the set doesn't match any preset (= "Custom" in the UI).
 */
export function detectStaffPreset(
  scopes: readonly Scope[],
): StaffRoleKey | null {
  for (const key of STAFF_ROLES) {
    if (setsEqual(scopes, STAFF_ROLE_PRESETS[key])) return key
  }
  return null
}

/**
 * Same as `detectStaffPreset` but for tenant memberships. Returns
 * `null` for custom scope mixes.
 */
export function detectTenantPreset(
  scopes: readonly Scope[],
): TenantRolePresetKey | null {
  for (const key of TENANT_ROLE_PRESET_KEYS) {
    if (setsEqual(scopes, TENANT_ROLE_PRESETS[key])) return key
  }
  return null
}

/**
 * Type guard: is the value one of the staff role preset keys.
 */
export function isStaffRole(role: unknown): role is StaffRoleKey {
  return typeof role === 'string' && (STAFF_ROLES as readonly string[]).includes(role)
}
