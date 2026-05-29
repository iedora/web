import { describe, it, expect } from 'vitest'
import { SCOPES, ALL_SCOPES, parseScope, scopeI18nKey, type Scope } from './scopes'

describe('SCOPES tree', () => {
  it('every leaf is a non-empty string in `<kind>:<product>:<resource>:<verb>` shape', () => {
    expect(ALL_SCOPES.length).toBeGreaterThan(0)
    for (const s of ALL_SCOPES) {
      expect(typeof s).toBe('string')
      const parts = s.split(':')
      expect(parts.length).toBe(4)
      for (const p of parts) expect(p.length).toBeGreaterThan(0)
    }
  })

  it('ALL_SCOPES has no duplicates', () => {
    expect(new Set(ALL_SCOPES).size).toBe(ALL_SCOPES.length)
  })

  it('kinds are restricted to staff or tenant', () => {
    for (const s of ALL_SCOPES) {
      expect(['staff', 'tenant']).toContain(s.split(':')[0])
    }
  })

  it('covers every iedora product known to the SCOPES tree top-level', () => {
    const products = new Set(ALL_SCOPES.map((s) => s.split(':')[1]))
    expect(products).toContain('core')
    expect(products).toContain('menu')
    expect(products).toContain('imopush')
  })

  it('has no leftover :write verbs (use :create/:update/:delete or specific actions)', () => {
    for (const s of ALL_SCOPES) {
      expect(s.endsWith(':write')).toBe(false)
    }
  })
})

describe('parseScope', () => {
  it('splits a valid scope into its four segments', () => {
    expect(parseScope(SCOPES.menu.tenant.restaurants.read as Scope)).toEqual({
      kind: 'tenant',
      product: 'menu',
      resource: 'restaurants',
      verb: 'read',
    })
  })

  it('throws on a malformed string', () => {
    expect(() => parseScope('not:a:scope' as Scope)).toThrow(
      /malformed scope/,
    )
  })
})

describe('scopeI18nKey', () => {
  it('builds the product-first dotted i18n key', () => {
    expect(scopeI18nKey(SCOPES.core.staff.users.read as Scope)).toBe(
      'scopes.core.staff.users.read',
    )
    expect(
      scopeI18nKey(SCOPES.imopush.tenant.idealista.publish as Scope),
    ).toBe('scopes.imopush.tenant.idealista.publish')
  })
})
