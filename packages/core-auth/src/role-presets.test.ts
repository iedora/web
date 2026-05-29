import { describe, it, expect } from 'vitest'
import {
  STAFF_ROLES,
  IEDORA_ADMIN_ROLE,
  IEDORA_SUPPORT_ROLE,
  STAFF_ROLE_PRESETS,
  TENANT_ROLE_PRESETS,
  TENANT_ROLE_PRESET_KEYS,
  detectStaffPreset,
  detectTenantPreset,
  isStaffRole,
} from './role-presets'
import { SCOPES, ALL_SCOPES } from './scopes'

/**
 * Contract for the preset registry. Three invariants:
 *
 *   1. Staff/tenant role literal constants are stable and exhaustive.
 *   2. Presets contain ONLY valid scopes from the `SCOPES` tree.
 *   3. `detect*Preset` is a perfect inverse of preset expansion —
 *      `detect(PRESET[key]) === key`.
 *
 * Pure module: no DB, no Next, no `server-only`.
 */

describe('STAFF_ROLES', () => {
  it('lists exactly the two staff role literals', () => {
    expect(STAFF_ROLES).toEqual([IEDORA_ADMIN_ROLE, IEDORA_SUPPORT_ROLE])
  })

  it('STAFF_ROLE_PRESETS keyed exactly by STAFF_ROLES literals', () => {
    expect(Object.keys(STAFF_ROLE_PRESETS).sort()).toEqual(
      [...STAFF_ROLES].sort(),
    )
  })

  it('iedora-admin preset wildcards every staff scope', () => {
    const expected = ALL_SCOPES.filter((s) => s.startsWith('staff:'))
    expect([...STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE]].sort()).toEqual(
      [...expected].sort(),
    )
  })

  it('iedora-support preset is a strict subset of iedora-admin', () => {
    const adminSet = new Set(STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE])
    for (const s of STAFF_ROLE_PRESETS[IEDORA_SUPPORT_ROLE]) {
      expect(adminSet.has(s)).toBe(true)
    }
    // …and strict — support must NOT carry every admin scope.
    expect(STAFF_ROLE_PRESETS[IEDORA_SUPPORT_ROLE].length).toBeLessThan(
      STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE].length,
    )
  })

  it('iedora-support cannot impersonate or set roles', () => {
    const support = STAFF_ROLE_PRESETS[IEDORA_SUPPORT_ROLE] as readonly string[]
    expect(support.includes(SCOPES.core.staff.users.impersonate)).toBe(false)
    expect(support.includes(SCOPES.core.staff.users.setRole)).toBe(false)
  })
})

describe('TENANT_ROLE_PRESETS', () => {
  it('exposes the four canonical preset keys', () => {
    expect(TENANT_ROLE_PRESET_KEYS).toEqual(['owner', 'admin', 'member', 'viewer'])
  })

  it('owner preset covers every tenant scope', () => {
    const expected = ALL_SCOPES.filter((s) => s.startsWith('tenant:'))
    expect([...TENANT_ROLE_PRESETS.owner].sort()).toEqual([...expected].sort())
  })

  it('admin preset excludes only tenant deletion', () => {
    expect(TENANT_ROLE_PRESETS.admin).not.toContain(
      SCOPES.core.tenant.tenant.delete,
    )
    const adminSet = new Set(TENANT_ROLE_PRESETS.admin)
    for (const s of TENANT_ROLE_PRESETS.owner) {
      if (s === SCOPES.core.tenant.tenant.delete) continue
      expect(adminSet.has(s)).toBe(true)
    }
  })

  it('viewer preset contains only :read scopes', () => {
    for (const s of TENANT_ROLE_PRESETS.viewer) {
      expect(s.endsWith(':read')).toBe(true)
    }
  })

  it('viewer covers every tenant :read scope (no read holes)', () => {
    const allTenantReads = ALL_SCOPES.filter(
      (s) => s.startsWith('tenant:') && s.endsWith(':read'),
    )
    expect([...TENANT_ROLE_PRESETS.viewer].sort()).toEqual(
      [...allTenantReads].sort(),
    )
  })

  it('member preset is a strict subset of admin', () => {
    const adminSet = new Set(TENANT_ROLE_PRESETS.admin)
    for (const s of TENANT_ROLE_PRESETS.member) {
      expect(adminSet.has(s)).toBe(true)
    }
  })
})

describe('detect*Preset (reverse mapping)', () => {
  it('round-trips every staff preset', () => {
    for (const key of STAFF_ROLES) {
      expect(detectStaffPreset(STAFF_ROLE_PRESETS[key])).toBe(key)
    }
  })

  it('round-trips every tenant preset', () => {
    for (const key of TENANT_ROLE_PRESET_KEYS) {
      expect(detectTenantPreset(TENANT_ROLE_PRESETS[key])).toBe(key)
    }
  })

  it('returns null for custom (non-preset) scope mixes', () => {
    expect(
      detectTenantPreset([SCOPES.imopush.tenant.idealista.publish]),
    ).toBeNull()
    expect(
      detectStaffPreset([SCOPES.core.staff.audit.read]),
    ).toBeNull()
  })

  it('returns null for an empty scope set', () => {
    expect(detectStaffPreset([])).toBeNull()
    expect(detectTenantPreset([])).toBeNull()
  })

  it('is order-insensitive (set equality)', () => {
    const reversed = [...TENANT_ROLE_PRESETS.member].reverse()
    expect(detectTenantPreset(reversed)).toBe('member')
  })
})

describe('isStaffRole type guard', () => {
  it('returns true for canonical staff literals', () => {
    expect(isStaffRole(IEDORA_ADMIN_ROLE)).toBe(true)
    expect(isStaffRole(IEDORA_SUPPORT_ROLE)).toBe(true)
  })

  it('returns false for tenant-only / unknown values', () => {
    expect(isStaffRole(null)).toBe(false)
    expect(isStaffRole(undefined)).toBe(false)
    expect(isStaffRole('')).toBe(false)
    expect(isStaffRole('owner')).toBe(false)
    expect(isStaffRole('iedora-admin-typo')).toBe(false)
    expect(isStaffRole(42)).toBe(false)
  })
})
