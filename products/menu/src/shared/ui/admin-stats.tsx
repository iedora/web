/**
 * Editorial stat primitives for cross-tenant admin surfaces. Same
 * tokens (paper / ink / cinnabar, mono labels, hairline borders) the
 * Iedora Manual § VI.5 prescribes for tabular data, factored out so
 * every admin page renders the same way.
 *
 * Lives in `shared/ui` (not `@iedora/design-system`) because these are
 * menu-product-specific compositions over the design system's tokens —
 * not editorial primitives the house product would also reuse.
 */

import type { ReactNode } from 'react'

/** Section header strip — title + optional snapshot timestamp, right-aligned. */
export function StatsHeader({
  title,
  snapshotAt,
}: {
  title: string
  /** ISO timestamp (server-rendered). Displayed as `HH:mm:ssZ`. */
  snapshotAt?: string
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
        {title}
      </h2>
      {snapshotAt && (
        <p className="text-[10.5px] font-[family-name:var(--mono)] uppercase tracking-[0.18em] text-[var(--ink-40)]">
          snapshot @ {snapshotAt.slice(11, 19)}Z
        </p>
      )}
    </header>
  )
}

/**
 * One stat card. `tone="warn"` paints the number cinnabar when the
 * value is non-zero — used to flag "stale > 24h" / "no MFA" / etc.
 * Numbers render in tabular-nums (the design system's ds-table applies
 * this; we mirror it here for parity outside tables).
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'normal',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'normal' | 'warn'
}) {
  const numberTone =
    tone === 'warn' && value !== '0' ? 'text-[var(--cinnabar)]' : 'text-[var(--ink)]'
  return (
    <div className="border border-[var(--ink-14)] bg-[var(--paper)] p-3">
      <div className="font-[family-name:var(--mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl tabular-nums ${numberTone}`}>{value}</div>
      {hint && (
        <div className="font-[family-name:var(--mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--ink-40)]">
          {hint}
        </div>
      )}
    </div>
  )
}

export type HistogramEntry = { name: string; count: number }

/**
 * Text-based bar chart — name · bar · count. Bar widths normalized to
 * the total so they're comparable across entries. Renders "No data"
 * when empty so the slot keeps its shape (prevents the rest of the
 * layout from reflowing on first load).
 */
export function Histogram({
  label,
  entries,
}: {
  label: string
  entries: ReadonlyArray<HistogramEntry>
}) {
  const total = entries.reduce((acc, e) => acc + e.count, 0)
  return (
    <div className="border border-[var(--ink-14)] bg-[var(--paper)] p-3">
      <div className="font-[family-name:var(--mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
        {label}
      </div>
      {entries.length === 0 ? (
        <div className="mt-1 text-sm text-[var(--ink-40)]">No data.</div>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {entries.map((e) => {
            const pct = total === 0 ? 0 : (e.count / total) * 100
            return (
              <li key={e.name} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-[var(--ink)]">{e.name}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden bg-[var(--ink-14)]">
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-[var(--ink)]"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-10 text-right font-[family-name:var(--mono)] tabular-nums text-[var(--ink-55)]">
                  {e.count}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Layout wrapper — stacks `<StatsHeader>` + a responsive grid of stats
 * + an optional row of histograms. Just CSS grid; pure presentational.
 */
export function StatsPanel({
  title,
  snapshotAt,
  stats,
  histograms,
}: {
  title: string
  snapshotAt?: string
  stats: ReadonlyArray<ReactNode>
  histograms?: ReadonlyArray<ReactNode>
}) {
  return (
    <section className="space-y-4">
      <StatsHeader title={title} snapshotAt={snapshotAt} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats}
      </div>
      {histograms && histograms.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {histograms}
        </div>
      )}
    </section>
  )
}
