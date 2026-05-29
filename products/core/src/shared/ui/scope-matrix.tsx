import * as React from 'react'
import { Badge } from '@iedora/design-system'

/**
 * Scope rendering primitives — shared between the admin overview
 * (which renders every staff role preset as reference material) and
 * the user detail page (which renders the live scope set of one user
 * with preset attribution).
 *
 * Scopes follow `<kind>:<product>:<resource>:<verb>` (see
 * `@iedora/core-auth/scopes`). We group by `<kind>:<product>` because
 * that's the boundary humans reason about ("what can support do in
 * core?", "what can a tenant member do in menu?").
 */

export type GroupedScopes = {
  /** `<kind>:<product>` e.g. `staff:core`, `tenant:menu`. */
  prefix: string
  scopes: ReadonlyArray<string>
}[]

/**
 * Group a flat scope array by the first two segments — keeps the UI
 * organised when a single role carries 13+ scopes spread across the
 * product axis.
 */
export function groupScopes(scopes: ReadonlyArray<string>): GroupedScopes {
  const buckets = new Map<string, string[]>()
  for (const s of scopes) {
    const parts = s.split(':')
    const prefix = parts.slice(0, 2).join(':')
    const bucket = buckets.get(prefix)
    if (bucket) bucket.push(s)
    else buckets.set(prefix, [s])
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, list]) => ({
      prefix,
      scopes: list.sort(),
    }))
}

/**
 * Render a flat scope list grouped by `<kind>:<product>`. Each group
 * heading shows the prefix + count. Compact: mono font, hairline
 * separator between groups, no card chrome (caller wraps).
 */
export function ScopeList({
  scopes,
  emptyLabel,
  'data-test-id': testId,
}: {
  scopes: ReadonlyArray<string>
  emptyLabel: string
  'data-test-id'?: string
}) {
  if (scopes.length === 0) {
    return (
      <p
        className="text-sm italic text-[var(--ink-55)]"
        data-test-id={testId ? `${testId}-empty` : undefined}
      >
        {emptyLabel}
      </p>
    )
  }
  const groups = groupScopes(scopes)
  return (
    <div className="space-y-4" data-test-id={testId}>
      {groups.map((g) => (
        <div key={g.prefix}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h4 className="font-[family-name:var(--mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
              {g.prefix}
            </h4>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-40)] tabular-nums">
              {g.scopes.length}
            </span>
          </div>
          <ul className="space-y-0.5">
            {g.scopes.map((s) => (
              <li
                key={s}
                className="font-[family-name:var(--mono)] text-[12px] text-[var(--ink-70)]"
                data-test-id={
                  testId ? `${testId}-${s.replace(/:/g, '-')}` : undefined
                }
              >
                {s.slice(g.prefix.length + 1)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/**
 * A preset header — name badge + scope count + optional source note
 * ("Default" for built-ins, "Override" / "Custom" otherwise). Used by
 * the overview matrix above each role's `<ScopeList>`.
 */
export function PresetHeader({
  name,
  scopeCount,
  sourceLabel,
  highlight,
  'data-test-id': testId,
}: {
  name: string
  scopeCount: number
  sourceLabel: string
  highlight?: boolean
  'data-test-id'?: string
}) {
  return (
    <div
      className="flex flex-wrap items-baseline justify-between gap-2"
      data-test-id={testId}
    >
      <div className="flex items-center gap-2">
        <Badge variant={highlight ? 'accent' : 'ink'}>{name}</Badge>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
          {sourceLabel}
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-40)] tabular-nums">
        {scopeCount}
      </span>
    </div>
  )
}
