'use client'

import { useState, useTransition } from 'react'
import {
  Button,
  Field,
  FieldInput,
  FieldLabel,
  Table,
  Td,
  Th,
} from '@iedora/design-system'
import {
  bindCodeAction,
  bulkGenerateAction,
  createCodeAction,
  deleteCodeAction,
  unbindCodeAction,
} from '../actions'
import type { QrCodeListRow } from '../ports'

type RestaurantOption = { id: string; name: string; slug: string }

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
}: {
  rows: QrCodeListRow[]
  restaurants: RestaurantOption[]
  publicOrigin: string
}) {
  return (
    <div className="space-y-10">
      <CreateOneForm restaurants={restaurants} />
      <BulkGenerateForm />
      <CodesTable rows={rows} restaurants={restaurants} publicOrigin={publicOrigin} />
    </div>
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
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
        Create one
      </h2>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="qr-code">Code (leave blank to generate)</FieldLabel>
          <FieldInput
            id="qr-code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="auto"
            maxLength={64}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="qr-restaurant">Bind to restaurant (optional)</FieldLabel>
          <select
            id="qr-restaurant"
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            className="h-10 rounded-md border border-[var(--ink-14)] bg-[var(--paper)] px-3 text-sm"
          >
            <option value="">— unbound —</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.slug})
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="qr-label">Label (optional)</FieldLabel>
          <FieldInput
            id="qr-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Box A — May 2026"
            maxLength={200}
          />
        </Field>
        <Button variant="solid" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {error && <p className="text-sm text-[var(--cinnabar)]">{error}</p>}
      {success && <p className="text-sm text-[var(--ink-55)]">{success}</p>}
    </section>
  )
}

// ── Bulk generate ─────────────────────────────────────────────────────────────

function BulkGenerateForm() {
  const [count, setCount] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<string[] | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setGenerated(null)
    startTransition(async () => {
      const res = await bulkGenerateAction(count)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setGenerated(res.data.codes)
    })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
        Bulk generate (unbound)
      </h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <Field>
          <FieldLabel htmlFor="qr-bulk-count">How many?</FieldLabel>
          <FieldInput
            id="qr-bulk-count"
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Button variant="solid" type="submit" disabled={pending}>
          {pending ? 'Generating…' : `Generate ${count}`}
        </Button>
      </form>
      {error && <p className="text-sm text-[var(--cinnabar)]">{error}</p>}
      {generated && (
        <details open className="rounded-md border border-[var(--ink-14)] p-3 text-sm">
          <summary className="cursor-pointer">
            {generated.length} new code{generated.length === 1 ? '' : 's'}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-[var(--ink-55)]">
            {generated.join('\n')}
          </pre>
        </details>
      )}
    </section>
  )
}

// ── Codes table ───────────────────────────────────────────────────────────────

function CodesTable({
  rows,
  restaurants,
  publicOrigin,
}: {
  rows: QrCodeListRow[]
  restaurants: RestaurantOption[]
  publicOrigin: string
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
        Registry ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ink-55)]">No codes yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>URL</Th>
              <Th>Bound to</Th>
              <Th>Label</Th>
              <Th>Actions</Th>
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
  const publicUrl = `${publicOrigin}/q/${row.code}`

  function onBindChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
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
        <span className="font-mono text-xs">{row.code}</span>
      </Td>
      <Td>
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--ink-55)] underline"
        >
          {publicUrl}
        </a>
      </Td>
      <Td>
        <select
          value={row.restaurantId ?? ''}
          onChange={onBindChange}
          disabled={pending}
          className="h-8 rounded-md border border-[var(--ink-14)] bg-[var(--paper)] px-2 text-xs"
        >
          <option value="">— unbound —</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-[var(--cinnabar)]">{error}</p>}
      </Td>
      <Td>
        <span className="text-xs text-[var(--ink-55)]">{row.label ?? '—'}</span>
      </Td>
      <Td>
        <Button variant="ghost" type="button" onClick={onDelete} disabled={pending}>
          Delete
        </Button>
      </Td>
    </tr>
  )
}
