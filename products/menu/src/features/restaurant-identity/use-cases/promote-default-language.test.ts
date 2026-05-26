import { describe, expect, it, vi } from 'vitest'

// Helpers use `'server-only'` to keep them out of Client Components;
// in Vitest the module has no shim, so mock it to an empty export.
vi.mock('server-only', () => ({}))

import {
  promoteField,
  promoteNullableField,
  promoteVariants,
} from './promote-default-language'

describe('promoteField (required field)', () => {
  it('no-ops when oldDefault === newDefault', () => {
    const r = promoteField('Vinho da casa', { en: 'House wine' }, 'pt', 'pt')
    expect(r).toEqual({
      source: 'Vinho da casa',
      i18n: { en: 'House wine' },
      promoted: false,
      needsAttention: false,
    })
  })

  it('promotes i18n[newDefault] into the source slot and demotes the old source', () => {
    const r = promoteField('Vinho da casa', { en: 'House wine' }, 'pt', 'en')
    expect(r.source).toBe('House wine')
    // OLD source moves into the OLD default's slot; the new-default
    // entry is removed (it's now the source).
    expect(r.i18n).toEqual({ pt: 'Vinho da casa' })
    expect(r.promoted).toBe(true)
    expect(r.needsAttention).toBe(false)
  })

  it('preserves unrelated translation entries during the swap', () => {
    const r = promoteField(
      'Vinho da casa',
      { en: 'House wine', es: 'Vino de la casa', fr: 'Vin maison' },
      'pt',
      'en',
    )
    expect(r.source).toBe('House wine')
    expect(r.i18n).toEqual({
      pt: 'Vinho da casa',
      es: 'Vino de la casa',
      fr: 'Vin maison',
    })
    expect(r.promoted).toBe(true)
  })

  it('flags needsAttention when no translation exists to promote', () => {
    const r = promoteField('Vinho da casa', { es: 'Vino' }, 'pt', 'en')
    // No en translation → source stays as PT, operator must fix.
    expect(r.source).toBe('Vinho da casa')
    expect(r.i18n).toEqual({ es: 'Vino' })
    expect(r.promoted).toBe(false)
    expect(r.needsAttention).toBe(true)
  })

  it('does NOT flag needsAttention when the source was empty in the first place', () => {
    // An empty row (no source content) is not a problem — there was
    // nothing to translate. Don't pester the operator about it.
    const r = promoteField('', null, 'pt', 'en')
    expect(r.promoted).toBe(false)
    expect(r.needsAttention).toBe(false)
  })

  it('does NOT demote an empty old source into the OLD slot (keeps map tidy)', () => {
    const r = promoteField('', { en: 'House wine' }, 'pt', 'en')
    expect(r.source).toBe('House wine')
    // No pt key added — empty values shouldn't pollute the i18n map.
    expect(r.i18n).toBeNull()
    expect(r.promoted).toBe(true)
  })

  it('handles undefined i18n (untranslated row)', () => {
    const r = promoteField('Vinho', undefined, 'pt', 'en')
    expect(r.source).toBe('Vinho')
    expect(r.i18n).toBeNull()
    expect(r.needsAttention).toBe(true)
  })
})

describe('promoteNullableField (description)', () => {
  it('passes null source through cleanly', () => {
    const r = promoteNullableField(null, null, 'pt', 'en')
    expect(r.source).toBeNull()
    expect(r.needsAttention).toBe(false)
  })

  it('promotes when a translation exists', () => {
    const r = promoteNullableField(
      'Vinho tinto da casa',
      { en: 'House red' },
      'pt',
      'en',
    )
    expect(r.source).toBe('House red')
    expect(r.i18n).toEqual({ pt: 'Vinho tinto da casa' })
    expect(r.promoted).toBe(true)
  })

  it('returns null source (not empty string) when the promotion clears it', () => {
    // Edge case: i18n[newDefault] is explicitly empty string. We treat
    // that as "no translation" and skip promotion — source stays as PT.
    const r = promoteNullableField(null, { en: '' }, 'pt', 'en')
    expect(r.source).toBeNull()
    expect(r.promoted).toBe(false)
  })

  it('does NOT flag needsAttention for a description that was always empty', () => {
    const r = promoteNullableField(null, { es: 'sólo descripción' }, 'pt', 'en')
    expect(r.promoted).toBe(false)
    expect(r.needsAttention).toBe(false)
  })
})

describe('promoteVariants', () => {
  it('returns empty + zero counts for null / [] inputs', () => {
    expect(promoteVariants(null, 'pt', 'en')).toEqual({
      variants: [],
      promoted: 0,
      needsAttention: 0,
    })
    expect(promoteVariants([], 'pt', 'en')).toEqual({
      variants: [],
      promoted: 0,
      needsAttention: 0,
    })
  })

  it('promotes every variant in a single pass', () => {
    const res = promoteVariants(
      [
        { label: 'Dose', labelI18n: { en: 'Full' }, priceCents: 1500 },
        { label: 'Meia dose', labelI18n: { en: 'Half' }, priceCents: 800 },
      ],
      'pt',
      'en',
    )
    expect(res.promoted).toBe(2)
    expect(res.needsAttention).toBe(0)
    expect(res.variants).toEqual([
      { label: 'Full', labelI18n: { pt: 'Dose' }, priceCents: 1500 },
      { label: 'Half', labelI18n: { pt: 'Meia dose' }, priceCents: 800 },
    ])
  })

  it('counts untranslated variants in needsAttention but still rewrites the array', () => {
    const res = promoteVariants(
      [
        { label: 'Dose', labelI18n: { en: 'Full' }, priceCents: 1500 },
        // No labelI18n → can't promote, flagged
        { label: 'Meia dose', priceCents: 800 },
      ],
      'pt',
      'en',
    )
    expect(res.promoted).toBe(1)
    expect(res.needsAttention).toBe(1)
    expect(res.variants[0]?.label).toBe('Full')
    // Second variant kept as-is, will show "Meia dose" in the EN slot.
    expect(res.variants[1]?.label).toBe('Meia dose')
  })
})
