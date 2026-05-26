import type { AnalyticsRange, DailyPoint } from '@/features/metrics'

/**
 * Generic three-line KPI card. Eyebrow on top (small uppercase), big number,
 * caption beneath in serif italic. The brand color on the number is the
 * accent that ties the analytics block to the rest of the printed-carta
 * vocabulary.
 */
export function KpiCard({
  testId,
  eyebrow,
  value,
  caption,
}: {
  testId: string
  eyebrow: string
  value: string
  caption: string
}) {
  return (
    <article
      data-testid={testId}
      className="border border-border bg-background p-3 sm:p-5"
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {eyebrow}
      </div>
      <div className="mt-3 text-[28px] font-semibold tabular-nums leading-none text-brand">
        {value}
      </div>
      <div className="mt-2 font-serif text-[12px] italic text-muted-foreground">
        {caption}
      </div>
    </article>
  )
}

/**
 * SCAN RHYTHM card. Same shell as `KpiCard` plus a per-day sparkline. Bars
 * scale relative to the period's max so a slow day isn't invisible. We
 * deliberately don't render labels on the chart — it's a rhythm cue, not a
 * data table; hover titles surface the per-day count when a curious user
 * needs the number.
 */
export function ScansCard({
  range,
  total,
  breakdown,
  labels,
}: {
  range: AnalyticsRange
  total: number
  today: number
  breakdown: DailyPoint[]
  labels: { eyebrow: string; tagline: string }
}) {
  const max = breakdown.reduce((m, p) => (p.count > m ? p.count : m), 0)
  return (
    <article
      data-testid="analytics-scans"
      className="border border-border bg-background p-3 sm:p-5"
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {labels.eyebrow}
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-[28px] font-semibold tabular-nums leading-none text-brand">
          {total.toLocaleString()}
        </span>
        <span className="font-serif text-[12px] italic text-muted-foreground">
          {labels.tagline}
        </span>
      </div>

      {breakdown.length > 0 && (
        <div
          aria-hidden="true"
          data-testid="scans-sparkline"
          className="mt-4 flex h-8 items-end gap-0.5"
        >
          {breakdown.map((p) => {
            const ratio = max > 0 ? p.count / max : 0
            return (
              <span
                key={p.day}
                title={`${p.day}: ${p.count}`}
                className="flex-1 bg-brand"
                style={{
                  height: `${Math.max(ratio * 100, p.count > 0 ? 8 : 4)}%`,
                  opacity: p.count > 0 ? 1 : 0.25,
                }}
              />
            )
          })}
        </div>
      )}

      {breakdown.length === 0 && range === 'today' && (
        <div className="mt-4 h-8" />
      )}
    </article>
  )
}

/**
 * Larger sibling of the in-card sparkline: full-width bar chart with peak
 * marker and first/last day labels. Bars share the same brand fill so the
 * page reads as a single instrument across SCANS card → chart. Pure DOM
 * (no SVG) so each bar `flex-1`s naturally and the chart resizes with the
 * viewport without measuring or hydration.
 *
 * Bars use `--bar-min-height` semantics: every non-zero day is at least 4%
 * tall so a quiet day doesn't disappear; zeros get a faint stub so the
 * baseline rhythm stays visible.
 */
export function ScansChart({
  breakdown,
  eyebrow,
  peakLabel,
  locale,
}: {
  breakdown: DailyPoint[]
  eyebrow: string
  /** Already-formatted "peak N" copy from the page; null when the period has
   *  no scans (the chart hides the indicator entirely). */
  peakLabel: string | null
  locale: string
}) {
  if (breakdown.length < 2) return null
  const max = breakdown.reduce((m, p) => (p.count > m ? p.count : m), 0)
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  })
  const parse = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    return new Date(Date.UTC(y, m - 1, d))
  }
  // `breakdown.length >= 2` was guarded above, so both ends exist.
  const first = breakdown[0]!
  const last = breakdown[breakdown.length - 1]!

  return (
    <article
      data-testid="scans-chart"
      className="border border-border bg-background p-3 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {eyebrow}
        </div>
        {peakLabel && (
          <div
            data-testid="scans-chart-peak"
            className="font-serif text-[12px] italic text-muted-foreground"
          >
            {peakLabel}
          </div>
        )}
      </div>

      <div
        role="img"
        aria-label={eyebrow}
        className="mt-4 flex h-32 items-end gap-1 sm:h-40 sm:gap-1.5"
      >
        {breakdown.map((p) => {
          const ratio = max > 0 ? p.count / max : 0
          return (
            <span
              key={p.day}
              data-testid="scans-chart-bar"
              title={`${fmt.format(parse(p.day))}: ${p.count}`}
              className="flex-1 bg-brand"
              style={{
                height: `${Math.max(ratio * 100, p.count > 0 ? 4 : 2)}%`,
                opacity: p.count > 0 ? 1 : 0.18,
              }}
            />
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{fmt.format(parse(first.day))}</span>
        <span>{fmt.format(parse(last.day))}</span>
      </div>
    </article>
  )
}
