/**
 * Format a row's "edited X" timestamp the way the carta-style design wants:
 *   - within the last 60 minutes → "X minutes ago"
 *   - same calendar day → "today, HH:mm"
 *   - calendar day before → "yesterday, HH:mm"
 *   - within the same week → weekday name + ", HH:mm" ("Sunday, 11:02")
 *   - older → "N weeks ago" / "N months ago"
 *
 * Uses `Intl.DateTimeFormat` for the time portion so it respects the
 * caller's locale; the relative copy is formatted via `Intl.RelativeTimeFormat`.
 *
 * `now` is injected so tests can lock the output without monkey-patching
 * Date globally.
 */
export function formatEditedAt(
  at: Date,
  locale: string,
  now: Date = new Date(),
): string {
  const diffMs = now.getTime() - at.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  const diffHour = Math.round(diffMs / (60 * 60_000))
  const diffDay = Math.round(diffMs / (24 * 60 * 60_000))

  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffMin < 1) return rtf.format(0, 'minute')
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')

  // Same calendar day
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  if (sameDay) return `${rtf.format(0, 'day')}, ${time}`

  // Calendar day before
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const wasYesterday =
    at.getFullYear() === yesterday.getFullYear() &&
    at.getMonth() === yesterday.getMonth() &&
    at.getDate() === yesterday.getDate()
  if (wasYesterday) return `${rtf.format(-1, 'day')}, ${time}`

  // Same week (within 6 days, weekday name)
  if (diffDay < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at)
    return `${weekday}, ${time}`
  }

  // Older
  if (diffDay < 30) return rtf.format(-Math.floor(diffDay / 7), 'week')
  if (diffDay < 365) return rtf.format(-Math.floor(diffDay / 30), 'month')
  return rtf.format(-Math.floor(diffDay / 365), 'year')
}

/**
 * Format a percentage delta with a directional triangle. Returns the marker
 * separately from the value so the row can color them independently.
 */
export function formatDelta(deltaPct: number): { marker: '▲' | '▼' | '·'; value: string } {
  if (deltaPct > 0) return { marker: '▲', value: `${Math.round(deltaPct)}%` }
  if (deltaPct < 0) return { marker: '▼', value: `${Math.round(Math.abs(deltaPct))}%` }
  return { marker: '·', value: `0%` }
}

/**
 * Format the row's index badge. Pads to two digits to match the design's
 * "01.", "02." treatment.
 */
export function formatIndex(n: number): string {
  return `${String(n).padStart(2, '0')}.`
}
