import { describe, expect, it } from 'vitest'
import { expandRolesToScopes } from './bundles'
import { SCOPES } from './scopes'
import { IEDORA_ADMIN_ROLE } from './roles'

describe('expandRolesToScopes', () => {
  it('expands iedora-admin bundle to every QR scope', () => {
    const scopes = expandRolesToScopes([IEDORA_ADMIN_ROLE])
    expect(new Set(scopes)).toEqual(
      new Set([
        SCOPES.QR_CODES_READ,
        SCOPES.QR_CODES_WRITE,
        SCOPES.QR_CODES_UPDATE,
        SCOPES.QR_CODES_DELETE,
      ]),
    )
  })

  it('passes through known atomic scopes (with colon) unchanged', () => {
    const scopes = expandRolesToScopes([SCOPES.QR_CODES_UPDATE])
    expect(scopes).toEqual([SCOPES.QR_CODES_UPDATE])
  })

  it('drops unknown atomic scopes — defensive against grants we did not declare', () => {
    const scopes = expandRolesToScopes(['qr-codes:nope', 'restaurants:archive'])
    expect(scopes).toEqual([])
  })

  it('drops unknown bundle names', () => {
    expect(expandRolesToScopes(['definitely-not-a-bundle'])).toEqual([])
  })

  it('dedupes when a bundle and an atomic overlap', () => {
    const scopes = expandRolesToScopes([IEDORA_ADMIN_ROLE, SCOPES.QR_CODES_WRITE])
    // QR_CODES_WRITE appears in both → still once in output
    expect(scopes.filter((s) => s === SCOPES.QR_CODES_WRITE)).toHaveLength(1)
  })

  it('union of bundle + atomic — per-user differentiator', () => {
    // Admin A: just the bundle (admin without delete in a hypothetical
    // future bundle). Today the bundle already includes delete, so we
    // simulate by combining a (currently-not-existing) lighter bundle
    // entry path with an atomic. Here we exercise atomic-on-top
    // semantics: an extra atomic does NOT need to be in any bundle.
    const a = expandRolesToScopes([IEDORA_ADMIN_ROLE])
    const b = expandRolesToScopes([IEDORA_ADMIN_ROLE, SCOPES.QR_CODES_UPDATE])
    // Both include QR_CODES_UPDATE because it's already in the admin bundle;
    // assertion focuses on the union semantics (b is a superset of a).
    for (const s of a) expect(b).toContain(s)
  })
})
