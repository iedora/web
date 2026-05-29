import { describe, expect, it } from 'vitest'
import { ALL_SCOPES, parseScope, scopeI18nKey } from '@iedora/core-auth/scopes'
import en from './messages/en.json'

/**
 * Contract: every scope in `ALL_SCOPES` MUST have a translation under
 * `Core.admin.access.scopes.<product>.<kind>.<resource>.<verb>` in
 * the English catalogue (the fallback for every other locale).
 *
 * Without this guard the access page renders raw key paths like
 * `Core.admin.access.scopes.core.tenant.members.grant` whenever a
 * scope is added in `packages/core-auth/src/scopes.ts` and someone forgets
 * to add the matching i18n entry. The two used to drift constantly.
 *
 * Same guard for `Core.admin.access.products.<product>` + `kinds.<kind>` —
 * the access page reads those for the section headings.
 */

type Messages = Record<string, unknown>

function get(obj: Messages, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Messages)[key]
          : undefined,
      obj,
    )
}

const access = (en as Messages).Core
  ? ((en as { Core: { admin: { access: Messages } } }).Core.admin.access as Messages)
  : ({} as Messages)

describe('scope i18n catalogue (en.json)', () => {
  it.each(ALL_SCOPES.map((s) => [s] as const))(
    '%s has a description string',
    (scope) => {
      const value = get(access, scopeI18nKey(scope))
      expect(typeof value, `missing scope translation: ${scopeI18nKey(scope)}`).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
    },
  )

  it('every product appearing in ALL_SCOPES has a products.* label', () => {
    const products = new Set(ALL_SCOPES.map((s) => parseScope(s).product))
    for (const p of products) {
      const value = get(access, `products.${p}`)
      expect(typeof value, `missing products.${p}`).toBe('string')
    }
  })

  it('every kind appearing in ALL_SCOPES has a kinds.* label', () => {
    const kinds = new Set(ALL_SCOPES.map((s) => parseScope(s).kind))
    for (const k of kinds) {
      const value = get(access, `kinds.${k}`)
      expect(typeof value, `missing kinds.${k}`).toBe('string')
    }
  })
})
