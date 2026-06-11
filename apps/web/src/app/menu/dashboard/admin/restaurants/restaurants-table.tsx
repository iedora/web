'use client'

import Link from 'next/link'
import { useDeferredValue, useMemo, useState } from 'react'

export type AdminRestaurantRow = {
  id: string
  name: string
  slug: string
  tenantId: string
  menuCount: number
  dishCount: number
  views30d: number
  updatedAt: string // ISO
}

type SortKey = 'updatedAt' | 'name' | 'views30d'
type SortDir = 'asc' | 'desc'

const DATE_FMT = new Intl.DateTimeFormat('pt-PT', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// Hoist Collator — `localeCompare` allocates one per call, this is
// invoked ~N·log(N) times per sort.
const PT_COLLATOR = new Intl.Collator('pt-PT')
const compareStr = PT_COLLATOR.compare

function formatStamp(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const parts = DATE_FMT.formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

export function RestaurantsTable({ rows }: { rows: AdminRestaurantRow[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  // Keep the input snappy while the table re-filters — deferred value
  // ignores the latest keystroke if React is still working on the
  // previous one.
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const filteredRows = rows.filter((r) => {
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.tenantId.toLowerCase().includes(q)
      )
    })
    const cmp = (a: AdminRestaurantRow, b: AdminRestaurantRow) => {
      let v = 0
      switch (sortKey) {
        case 'updatedAt':
          v = a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0
          break
        case 'name':
          v = compareStr(a.name, b.name)
          break
        case 'views30d':
          v = a.views30d - b.views30d
          break
      }
      return sortDir === 'asc' ? v : -v
    }
    return [...filteredRows].sort(cmp)
  }, [rows, deferredQuery, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const hasFilters = query.length > 0

  return (
    <div className="space-y-3" data-test-id="admin-restaurants-table">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar por nome, slug ou tenant…"
            aria-label="Procurar restaurantes"
            spellCheck={false}
            className="w-full rounded border border-[var(--ink-14)] bg-transparent px-3 py-2.5 text-sm placeholder:text-[var(--ink-40)] focus:border-[var(--ink)] focus:outline-none"
            data-test-id="admin-restaurants-search"
          />
        </div>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="rounded border border-[var(--ink-14)] px-3 py-2.5 text-xs uppercase tracking-[0.18em] text-[var(--ink-55)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            data-test-id="admin-restaurants-clear-filters"
          >
            Limpar
          </button>
        ) : null}
      </div>

      <p
        className="font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)]"
        data-test-id="admin-restaurants-count"
      >
        {filtered.length} de {rows.length}
      </p>

      <div className="overflow-x-auto rounded border border-[var(--ink-14)]">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-[var(--ink-14)] bg-[var(--paper-2)]">
            <tr>
              <SortableTh
                label="Restaurante"
                active={sortKey === 'name'}
                dir={sortDir}
                onClick={() => toggleSort('name')}
                testId="admin-restaurants-sort-name"
              />
              <th className="px-3 py-2 text-left text-[10.5px] font-[family-name:var(--mono)] font-normal uppercase tracking-[0.18em] text-[var(--ink-55)]">
                Conteúdo
              </th>
              <SortableTh
                label="Views 30d"
                active={sortKey === 'views30d'}
                dir={sortDir}
                onClick={() => toggleSort('views30d')}
                testId="admin-restaurants-sort-views"
                align="right"
              />
              <SortableTh
                label="Atualizado"
                active={sortKey === 'updatedAt'}
                dir={sortDir}
                onClick={() => toggleSort('updatedAt')}
                testId="admin-restaurants-sort-updated"
                align="right"
              />
              <th className="px-3 py-2 text-right">
                <span className="sr-only">Acções</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-[var(--ink-55)]"
                  data-test-id="admin-restaurants-empty"
                >
                  {hasFilters
                    ? 'Nenhum restaurante corresponde aos filtros.'
                    : 'Ainda não há restaurantes na plataforma.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const stamp = formatStamp(r.updatedAt)
                return (
                  <tr
                    key={r.id}
                    className="group border-t border-[var(--ink-14)] first:border-t-0 hover:bg-[var(--paper-2)]"
                    data-test-id={`admin-restaurants-row-${r.slug}`}
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium leading-tight">{r.name}</div>
                      <div className="font-[family-name:var(--mono)] text-[11px] text-[var(--ink-55)]">
                        /{r.slug}
                      </div>
                      <div
                        className="max-w-[180px] truncate font-[family-name:var(--mono)] text-[10px] text-[var(--ink-40)]"
                        title={r.tenantId}
                      >
                        {r.tenantId}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[13px] text-[var(--ink-70)] whitespace-nowrap">
                      {r.menuCount} menu{r.menuCount === 1 ? '' : 's'} ·{' '}
                      {r.dishCount} prato{r.dishCount === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-[family-name:var(--mono)] text-[11.5px] text-[var(--ink-55)] whitespace-nowrap tabular-nums">
                      {r.views30d}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-[family-name:var(--mono)] text-[11.5px] text-[var(--ink-55)] whitespace-nowrap tabular-nums">
                      <div>{stamp.date}</div>
                      <div className="text-[var(--ink-40)]">{stamp.time}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                      <Link
                        href={`/menu/dashboard/r/${r.slug}`}
                        className="rounded border border-[var(--ink-14)] px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] hover:border-[var(--ink)]"
                        data-test-id={`admin-restaurants-open-${r.slug}`}
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  testId,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  testId: string
  align?: 'left' | 'right'
}) {
  // Tailwind JIT can't resolve dynamic class names like `text-${align}` —
  // it scans source as strings. Map to full classes statically.
  const alignClass = align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[10.5px] font-[family-name:var(--mono)] font-normal uppercase tracking-[0.18em] ${alignClass}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${
          active ? 'text-[var(--cinnabar)]' : 'text-[var(--ink-55)] hover:text-[var(--ink)]'
        }`}
        data-test-id={testId}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[9px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : '·'}
        </span>
      </button>
    </th>
  )
}
