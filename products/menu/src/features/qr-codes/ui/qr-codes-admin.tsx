'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Button,
  Combobox,
  Field,
  FieldInput,
  FieldLabel,
  FieldHint,
  Table,
  Td,
  Th,
  Card,
  CardIndex,
  CardTitle,
  CardDesc,
  Badge,
  Separator,
  type ComboboxOption,
} from '@iedora/design-system'
import { Histogram, Stat, StatsPanel } from '@/shared/ui/admin-stats'
import {
  bindCodeAction,
  bulkGenerateAction,
  createCodeAction,
  deleteCodeAction,
  unbindCodeAction,
} from '../actions'
import type { QrCodeListRow } from '../ports'
import type { QrStats } from '../stats'

type RestaurantOption = { id: string; name: string; slug: string }

/** Project a restaurant list into ds Combobox options (label = name, hint = slug). */
function restaurantOptions(rs: ReadonlyArray<RestaurantOption>): ComboboxOption[] {
  return rs.map((r) => ({ value: r.id, label: r.name, hint: r.slug }))
}

/**
 * Admin surface — three things on one page:
 *   1. Create one code (custom name OR auto-generated).
 *   2. Bulk-generate N codes (unbound).
 *   3. Registry table: bind / unbind / delete each row.
 *
 * Server actions revalidate `/dashboard/admin/qr-codes` after every
 * mutation, so this component just submits and waits for the RSC payload
 * to refresh. Local error / status surfaces stay client-side.
 */
export function QrCodesAdmin({
  rows,
  restaurants,
  publicOrigin,
  stats,
  snapshotAt,
}: {
  rows: QrCodeListRow[]
  restaurants: RestaurantOption[]
  publicOrigin: string
  stats: QrStats
  /** ISO timestamp captured server-side when the page rendered. */
  snapshotAt: string
}) {
  return (
    <div className="space-y-12">
      <QrCodesStatsPanel stats={stats} snapshotAt={snapshotAt} />

      <Separator />

      {/* Forms Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="min-h-fit flex flex-col justify-between">
          <div>
            <CardIndex>
              <span>Option 01</span>
              <Badge variant="accent">Single</Badge>
            </CardIndex>
            <CardTitle as="h3" className="mt-4">Create One</CardTitle>
            <CardDesc className="mt-2 text-sm text-[var(--ink-55)]">
              Generate a single QR code, optionally binding it to a restaurant and adding an administrative label.
            </CardDesc>
          </div>
          <div className="mt-6 flex-1">
            <CreateOneForm restaurants={restaurants} />
          </div>
        </Card>

        <Card className="min-h-fit flex flex-col justify-between">
          <div>
            <CardIndex>
              <span>Option 02</span>
              <Badge variant="ink">Bulk</Badge>
            </CardIndex>
            <CardTitle as="h3" className="mt-4">Bulk Generate</CardTitle>
            <CardDesc className="mt-2 text-sm text-[var(--ink-55)]">
              Batch generate multiple unbound QR codes in a single operation.
            </CardDesc>
          </div>
          <div className="mt-6 flex-1">
            <BulkGenerateForm />
          </div>
        </Card>
      </div>

      <Separator />

      <CodesTable
        rows={rows}
        restaurants={restaurants}
        publicOrigin={publicOrigin}
        snapshotAt={snapshotAt}
      />
    </div>
  )
}

// ── Stats panel ─────────────────────────────────────────────────────────────

function QrCodesStatsPanel({
  stats,
  snapshotAt,
}: {
  stats: QrStats
  snapshotAt: string
}) {
  return (
    <StatsPanel
      title="Overview"
      snapshotAt={snapshotAt}
      stats={[
        <Stat key="total" label="Codes" value={String(stats.total)} />,
        <Stat key="bound" label="Bound" value={String(stats.bound)} />,
        <Stat
          key="unbound"
          label="Unbound"
          value={String(stats.unbound)}
          hint="ready to claim"
        />,
        <Stat
          key="labeled"
          label="Labeled"
          value={String(stats.withLabel)}
          hint="physical tag"
        />,
        <Stat
          key="new24"
          label="New 24h"
          value={String(stats.created24h)}
          hint="minted"
        />,
        <Stat
          key="bound24"
          label="Bound 24h"
          value={String(stats.boundLast24h)}
          hint="claimed"
        />,
      ]}
      histograms={[
        <Histogram
          key="restaurants"
          label="Top restaurants"
          entries={stats.topRestaurants}
        />,
      ]}
    />
  )
}

// ── Create one ────────────────────────────────────────────────────────────────

function CreateOneForm({ restaurants }: { restaurants: RestaurantOption[] }) {
  const [code, setCode] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await createCodeAction({
        code: code.trim() || undefined,
        restaurantId: restaurantId || undefined,
        label: label.trim() || undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSuccess(`Created code: ${res.data.code}`)
      setCode('')
      setLabel('')
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full justify-between space-y-6">
      <div className="space-y-6">
        <Field>
          <FieldLabel htmlFor="qr-code">Code</FieldLabel>
          <FieldInput
            id="qr-code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Auto-generated if left blank"
            maxLength={64}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="qr-restaurant">Bind to restaurant</FieldLabel>
          <Combobox
            id="qr-restaurant"
            options={restaurantOptions(restaurants)}
            value={restaurantId || null}
            onChange={(v) => setRestaurantId(v ?? '')}
            placeholder="— unbound —"
            searchPlaceholder="Search restaurants…"
            emptyMessage="No restaurants match."
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="qr-label">Administrative Label</FieldLabel>
          <FieldInput
            id="qr-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Box A — May 2026"
            maxLength={200}
          />
        </Field>
      </div>

      <div className="pt-4 space-y-3">
        <div className="flex justify-end">
          <Button variant="solid" type="submit" disabled={pending} arrow>
            {pending ? 'Creating…' : 'Create QR Code'}
          </Button>
        </div>
        {error && <p className="text-sm text-[var(--cinnabar)]">{error}</p>}
        {success && <p className="text-sm text-[var(--ink-55)]">{success}</p>}
      </div>
    </form>
  )
}

// ── Bulk generate ─────────────────────────────────────────────────────────────

function BulkGenerateForm() {
  const [count, setCount] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<string[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setGenerated(null)
    setCopied(false)
    startTransition(async () => {
      const res = await bulkGenerateAction(count)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setGenerated(res.data.codes)
    })
  }

  function handleCopy() {
    if (!generated) return
    navigator.clipboard.writeText(generated.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full justify-between space-y-6">
      <div className="space-y-6">
        <Field>
          <FieldLabel htmlFor="qr-bulk-count">Quantity to generate</FieldLabel>
          <FieldInput
            id="qr-bulk-count"
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <FieldHint>Supports generating between 1 and 500 codes per batch.</FieldHint>
        </Field>
      </div>

      <div className="pt-4 space-y-4">
        <div className="flex justify-end">
          <Button variant="solid" type="submit" disabled={pending} arrow>
            {pending ? 'Generating…' : 'Generate Batch'}
          </Button>
        </div>
        {error && <p className="text-sm text-[var(--cinnabar)]">{error}</p>}

        {generated && (
          <div className="mt-4 border border-[var(--ink-14)] p-4 bg-[var(--paper-2)] transition-all duration-300">
            <div className="flex items-center justify-between border-b border-[var(--ink-14)] pb-2 mb-2">
              <span className="font-mono text-[10.5px] text-[var(--ink-55)] uppercase tracking-wider">
                Generated {generated.length} code{generated.length === 1 ? '' : 's'}
              </span>
              <Button
                variant="ghost"
                type="button"
                onClick={handleCopy}
                className="text-[10px] py-1 px-2 h-7"
              >
                {copied ? 'Copied!' : 'Copy List'}
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-[var(--ink-70)]">
              {generated.join('\n')}
            </pre>
          </div>
        )}
      </div>
    </form>
  )
}

// ── Codes table ───────────────────────────────────────────────────────────────

function CodesTable({
  rows,
  restaurants,
  publicOrigin,
  snapshotAt,
}: {
  rows: QrCodeListRow[]
  restaurants: RestaurantOption[]
  publicOrigin: string
  snapshotAt: string
}) {
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
          Registry ({rows.length})
        </h2>
        <p className="text-[10.5px] font-[family-name:var(--mono)] uppercase tracking-[0.18em] text-[var(--ink-40)]">
          snapshot @ {snapshotAt.slice(11, 19)}Z
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ink-55)]">No codes yet.</p>
      ) : (
        <div className="overflow-x-auto border border-[var(--ink-14)]">
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th className="w-[12%]">Code</Th>
                <Th className="w-[36%]">URL</Th>
                <Th className="w-[28%]">Bound to</Th>
                <Th className="w-[14%]">Label</Th>
                <Th className="w-[10%] text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CodeRow
                  key={row.code}
                  row={row}
                  restaurants={restaurants}
                  publicOrigin={publicOrigin}
                />
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  )
}

function CodeRow({
  row,
  restaurants,
  publicOrigin,
}: {
  row: QrCodeListRow
  restaurants: RestaurantOption[]
  publicOrigin: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Sticker URL — what is printed on the QR. Canonical entry-point for
  // scanners (no redirect; the page renders directly at /q/[code]).
  const stickerUrl = `${publicOrigin}/q/${row.code}`
  // Branded URL — vanity / marketing alias. Only relevant once a code
  // is bound; an unbound code has no slug to show.
  const brandedUrl = row.restaurant
    ? `${publicOrigin}/r/${row.restaurant.slug}`
    : null

  function onBindChange(next: string | null) {
    setError(null)
    startTransition(async () => {
      const res = next
        ? await bindCodeAction({ code: row.code, restaurantId: next })
        : await unbindCodeAction(row.code)
      if (!res.ok) setError(res.error)
    })
  }

  function onDelete() {
    if (!confirm(`Delete code ${row.code}? This cannot be undone.`)) return
    setError(null)
    startTransition(async () => {
      const res = await deleteCodeAction(row.code)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <tr>
      <Td>
        <span className="font-mono text-xs text-[var(--ink)]">{row.code}</span>
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <Link
            href={`/q/${row.code}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Printed on the QR sticker"
            className="font-mono text-xs text-[var(--ink)] hover:text-[var(--cinnabar)] hover:underline inline-flex items-center gap-1 transition-colors"
          >
            <span className="truncate">{stickerUrl.replace(/^https?:\/\//, '')}</span>
            <span className="text-[10px] text-[var(--cinnabar)]">↗</span>
          </Link>
          {brandedUrl && row.restaurant && (
            <Link
              href={`/r/${row.restaurant.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Vanity URL for marketing / Instagram bio"
              className="font-mono text-[10px] text-[var(--ink-40)] hover:text-[var(--ink-55)] hover:underline inline-flex items-center gap-1 transition-colors"
            >
              <span className="font-[family-name:var(--mono)] uppercase tracking-[0.18em]">alias</span>
              <span className="truncate">{brandedUrl.replace(/^https?:\/\//, '')}</span>
            </Link>
          )}
        </div>
      </Td>
      <Td>
        <div className="w-full max-w-[240px]">
          <Combobox
            options={restaurantOptions(restaurants)}
            value={row.restaurantId ?? null}
            onChange={onBindChange}
            disabled={pending}
            placeholder="— unbound —"
            searchPlaceholder="Search restaurants…"
            emptyMessage="No matches."
          />
        </div>
        {error && <p className="mt-1 text-xs text-[var(--cinnabar)]">{error}</p>}
      </Td>
      <Td>
        {row.label ? (
          <span className="text-sm text-[var(--ink-70)]">{row.label}</span>
        ) : (
          <span className="text-sm text-[var(--ink-40)]">—</span>
        )}
      </Td>
      <Td className="text-right">
        <Button variant="ghost" type="button" onClick={onDelete} disabled={pending}>
          Delete
        </Button>
      </Td>
    </tr>
  )
}
