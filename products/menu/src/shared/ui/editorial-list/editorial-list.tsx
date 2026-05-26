import type { ReactNode } from 'react'
import { EditorialRow } from './editorial-row'
import type { EditorialRow as Row } from './types'

/**
 * Wrapper that renders an editorial-style list of rows. Header, footer, and
 * the empty state are slots — the page provides the content (eyebrow,
 * title, copy, CTAs) so the list itself stays focused on layout and rhythm.
 *
 * Pass an empty `rows` array to render `emptyState` if provided, otherwise
 * the wrapper renders nothing for the list area.
 */
export function EditorialList({
  rows,
  header,
  footer,
  emptyState,
  testId,
}: {
  rows: Row[]
  header?: ReactNode
  footer?: ReactNode
  emptyState?: ReactNode
  /** Optional data-testid on the list element for e2e selectors. */
  testId?: string
}) {
  return (
    <section className="space-y-6">
      {header}
      {rows.length === 0 ? (
        emptyState
      ) : (
        <div data-testid={testId ?? 'editorial-list'}>
          {rows.map((row) => (
            <EditorialRow key={row.id} row={row} />
          ))}
        </div>
      )}
      {rows.length > 0 && footer}
    </section>
  )
}
