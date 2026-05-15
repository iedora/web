import Link from 'next/link'
import { ActionChip } from './action-chip'
import styles from './editorial-list.module.css'
import { formatDelta } from './format'
import type { EditorialRow as Row } from './types'

/**
 * One row in the editorial list. The title is a `<Link>`; the chips and any
 * other interactive children are siblings of that link, never nested inside
 * it (nested anchors are invalid and break keyboard nav). The row's hover
 * effect lives on the outer `<div>` so it covers chip hover too.
 */
export function EditorialRow({ row }: { row: Row }) {
  const trailing = row.trailing
  return (
    <div className={styles.row} data-testid="editorial-row">
      <div className="flex items-baseline gap-3">
        {row.index && (
          <span
            aria-hidden="true"
            className="font-serif text-[12.5px] italic text-muted-foreground tabular-nums"
          >
            {row.index}
          </span>
        )}
        <Link
          href={row.href}
          className="block min-w-0 no-underline text-foreground"
        >
          <div className="text-[17px] font-medium leading-tight tracking-tight">
            {row.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[12.5px] text-muted-foreground">
            {row.subtitle}
          </div>
        </Link>
        <span aria-hidden="true" className={styles.leader} />
        {trailing ? (
          <div className="text-right">
            <div className="text-[15px] font-medium tabular-nums">
              {trailing.value === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {trailing.value.toLocaleString()}
                  {trailing.deltaPct !== undefined && (
                    <DeltaTag deltaPct={trailing.deltaPct} />
                  )}
                </>
              )}
            </div>
            {trailing.comparison && (
              <div className="font-serif text-[12px] italic text-muted-foreground mt-1">
                {trailing.comparison}
              </div>
            )}
          </div>
        ) : null}
      </div>
      {(row.metadata || (row.actions && row.actions.length > 0)) && (
        <div className={styles.subRow}>
          {row.metadata && (
            <span className="font-serif italic text-muted-foreground">
              {row.metadata}
            </span>
          )}
          {((row.actions && row.actions.length > 0) || row.extraActions) && (
            <span className="inline-flex flex-wrap items-center gap-2 ml-auto">
              {row.actions?.map((a) => (
                <ActionChip key={a.key} action={a} />
              ))}
              {row.extraActions}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function DeltaTag({ deltaPct }: { deltaPct: number }) {
  const { marker, value } = formatDelta(deltaPct)
  const positive = deltaPct > 0
  const negative = deltaPct < 0
  return (
    <span
      className={
        'ml-2 text-[12px] tabular-nums ' +
        (positive
          ? 'text-[#3d5a3a]'
          : negative
            ? 'text-[#9c4f3f]'
            : 'text-muted-foreground')
      }
    >
      {marker}
      {value}
    </span>
  )
}
