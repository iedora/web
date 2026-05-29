'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ActionCard,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  OrnamentRule,
} from '@iedora/design-system'
import { requestUploadUrl, commitAsset } from '../../upload/actions'
import type { PatchCurrentMenu, PatchOperation } from '../ports'
import { analyzeMenuPatch, applyMenuPatchAction } from '../actions'
import { CameraCapture } from './camera-capture'

/**
 * Update-menu wizard — the "second photo, only the changes" flow.
 *
 * Designed for an older operator on a phone. One primary CTA per step,
 * big tap targets, plain copy (no jargon), animated progress while the
 * AI runs so the wait reads like work, not a freeze.
 *
 * Three states, in order:
 *   1. capture   — Take photo OR upload from device (same as import)
 *   2. preview   — Diff: "+N items", "−N items", "N updated", checkboxes
 *   3. done      — Stats + close
 *
 * Token economy: the AI receives the current menu compactly (id + name
 * + price per item) and returns only operations. Items unchanged
 * between photo and DB don't make a round-trip.
 */

type Step =
  | { kind: 'capture' }
  | { kind: 'camera' }
  | {
      kind: 'preview'
      operations: PatchOperation[]
      selectedIndexes: Set<number>
    }
  | { kind: 'done'; stats: { addedItems: number; updatedItems: number; removedItems: number } }

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_BYTES = 10 * 1024 * 1024

const BUILDING_KEYS = [
  'updateMenuBuilding1',
  'updateMenuBuilding2',
  'updateMenuBuilding3',
  'updateMenuBuilding4',
] as const
const BUILDING_STEP_MS = 2400

function BuildingAnimation() {
  const t = useTranslations('Restaurant')
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % BUILDING_KEYS.length)
    }, BUILDING_STEP_MS)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--ink-24)] px-6 py-10 text-center"
      role="status"
      aria-live="polite"
      data-test-id="update-menu-progress"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cinnabar)] ds-pulse"
      />
      <p
        key={index}
        className="text-base italic text-[var(--ink)] menu-import-building-line"
        style={{ fontFamily: 'var(--serif)' }}
      >
        {t(BUILDING_KEYS[index]!)}
      </p>
    </div>
  )
}

// ─── Proposed-tree helper ─────────────────────────────────────────
//
// Walks `current` + the selected subset of `operations` and builds a
// unified category tree where every row knows its diff state. The
// preview renders THIS tree (not the raw operations) so the operator
// sees the menu the way their guests will after Apply — with markers
// for what changed.

type DiffState = 'unchanged' | 'added' | 'updated' | 'removed'

type ProposedVariant = { label: string; priceCents: number }

type ProposedItem = {
  rowKey: string
  name: string
  priceCents: number
  description?: string
  variants?: ProposedVariant[]
  state: DiffState
  /** Original values when state==='updated'. */
  original?: {
    name: string
    priceCents: number
    variants?: ProposedVariant[]
  }
  /** Index in operations[] for the controlling op (null when unchanged). */
  opIndex: number | null
}

type ProposedCategory = {
  rowKey: string
  name: string
  state: DiffState
  original?: { name: string }
  opIndex: number | null
  items: ProposedItem[]
}

function buildProposedTree(
  current: PatchCurrentMenu,
  operations: PatchOperation[],
  selected: ReadonlySet<number>,
): ProposedCategory[] {
  // Seed with the current menu — every row starts unchanged.
  const tree: ProposedCategory[] = current.categories.map((c) => ({
    rowKey: `cat:${c.id}`,
    name: c.name,
    state: 'unchanged',
    opIndex: null,
    items: c.items.map((it) => ({
      rowKey: `item:${it.id}`,
      name: it.name,
      priceCents: it.priceCents,
      ...(it.variants && it.variants.length > 0
        ? {
            variants: it.variants.map((v) => ({
              label: v.label,
              priceCents: v.priceCents,
            })),
          }
        : {}),
      state: 'unchanged',
      opIndex: null,
    })),
  }))

  // Track newly-added categories by name so subsequent add-item ops
  // with `categoryName` find them.
  const addedCatByName = new Map<string, ProposedCategory>()

  operations.forEach((op, idx) => {
    if (!selected.has(idx)) return

    switch (op.kind) {
      case 'add-category': {
        const newCat: ProposedCategory = {
          rowKey: `cat:new:${idx}`,
          name: op.name,
          state: 'added',
          opIndex: idx,
          items: op.items.map((it, j) => ({
            rowKey: `item:new:${idx}:${j}`,
            name: it.name,
            priceCents: it.priceCents,
            description: it.description,
            ...(it.variants && it.variants.length > 0 ? { variants: it.variants } : {}),
            state: 'added',
            opIndex: idx,
          })),
        }
        tree.push(newCat)
        addedCatByName.set(op.name, newCat)
        break
      }
      case 'rename-category': {
        const cat = tree.find((c) => c.opIndex === null && c.rowKey === `cat:${op.categoryId}`)
        if (cat) {
          cat.original = { name: cat.name }
          cat.name = op.name
          cat.state = 'updated'
          cat.opIndex = idx
        }
        break
      }
      case 'remove-category': {
        const cat = tree.find((c) => c.opIndex === null && c.rowKey === `cat:${op.categoryId}`)
        if (cat) {
          cat.state = 'removed'
          cat.opIndex = idx
        }
        break
      }
      case 'add-item': {
        const target =
          (op.categoryId &&
            tree.find((c) => c.rowKey === `cat:${op.categoryId}`)) ||
          (op.categoryName && addedCatByName.get(op.categoryName)) ||
          tree[0]
        if (target) {
          target.items.push({
            rowKey: `item:new:${idx}`,
            name: op.name,
            priceCents: op.priceCents,
            description: op.description,
            ...(op.variants && op.variants.length > 0 ? { variants: op.variants } : {}),
            state: 'added',
            opIndex: idx,
          })
        }
        break
      }
      case 'update-item': {
        for (const cat of tree) {
          const it = cat.items.find((i) => i.rowKey === `item:${op.itemId}`)
          if (it) {
            it.original = {
              name: it.name,
              priceCents: it.priceCents,
              ...(it.variants ? { variants: it.variants } : {}),
            }
            if (op.name !== undefined) it.name = op.name
            if (op.priceCents !== undefined) it.priceCents = op.priceCents
            if (op.description !== undefined) it.description = op.description
            // Variants is a FULL replacement when present (matches the
            // adapter's apply semantics); pass `[]` to clear.
            if (op.variants !== undefined) {
              it.variants =
                op.variants.length > 0
                  ? op.variants.map((v) => ({
                      label: v.label,
                      priceCents: v.priceCents,
                    }))
                  : undefined
            }
            it.state = 'updated'
            it.opIndex = idx
            break
          }
        }
        break
      }
      case 'remove-item': {
        for (const cat of tree) {
          const it = cat.items.find((i) => i.rowKey === `item:${op.itemId}`)
          if (it) {
            it.state = 'removed'
            it.opIndex = idx
            break
          }
        }
        break
      }
    }
  })

  return tree
}

// Tiny mono-styled chip for diff state. `+` / `~` / `−` glyphs in the
// matching ink-on-paper palette: cinnabar for added, ink for updated,
// muted for removed/unchanged. Mobile-friendly fixed width so the
// name column always aligns regardless of state.
function DiffMarker({ state }: { state: DiffState }) {
  const glyph =
    state === 'added' ? '+' :
    state === 'updated' ? '~' :
    state === 'removed' ? '−' : '·'
  const color =
    state === 'added' ? 'text-[var(--cinnabar)]' :
    state === 'updated' ? 'text-[var(--ink)]' :
    'text-[var(--muted-2)]'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex w-4 shrink-0 justify-center text-[13px] leading-none font-[family-name:var(--mono)] ${color}`}
    >
      {glyph}
    </span>
  )
}

function formatPrice(priceCents: number, currency: string): string {
  const amount = priceCents / 100
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(amount)
  } catch {
    return `€${amount.toFixed(2)}`
  }
}

export function UpdateMenuDialog({
  slug,
  restaurantId,
  menuId,
  current,
}: {
  slug: string
  restaurantId: string
  menuId: string
  current: PatchCurrentMenu
}) {
  const t = useTranslations('Restaurant')
  const router = useRouter()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'capture' })
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep({ kind: 'capture' })
    setError(null)
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function onPickFile(file: File) {
    setError(null)
    const mimeOk = (ACCEPTED_MIME as ReadonlyArray<string>).includes(file.type)
    if (!mimeOk) {
      setError(t('updateMenuUnsupportedType'))
      return
    }
    if (file.size > MAX_BYTES) {
      setError(t('updateMenuTooLarge'))
      return
    }

    startTransition(async () => {
      const presign = await requestUploadUrl({
        target: { kind: 'menu-import-photo', restaurantId },
        contentType: file.type,
        contentLengthBytes: file.size,
      })
      if (!presign.ok) { setError(presign.error); return }

      const put = await fetch(presign.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) { setError(`Upload failed (${put.status})`); return }

      const commit = await commitAsset({
        target: { kind: 'menu-import-photo', restaurantId },
        key: presign.data.key,
        publicUrl: presign.data.publicUrl,
      })
      if (!commit.ok) { setError(commit.error); return }

      const result = await analyzeMenuPatch(slug, presign.data.publicUrl, current)
      if ('error' in result) {
        if ('reason' in result && result.reason === 'ai-weekly-limit') {
          setError(result.error)
        } else {
          setError(t('updateMenuAiError'))
        }
        return
      }
      setStep({
        kind: 'preview',
        operations: result.operations,
        // All ops pre-selected — operator opts OUT of specific changes
        // rather than building up the diff manually.
        selectedIndexes: new Set(result.operations.map((_, i) => i)),
      })
    })
  }

  function toggleOp(idx: number) {
    setStep((prev) => {
      if (prev.kind !== 'preview') return prev
      const next = new Set(prev.selectedIndexes)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return { ...prev, selectedIndexes: next }
    })
  }

  function onApply() {
    if (step.kind !== 'preview') return
    const picked = step.operations.filter((_, i) => step.selectedIndexes.has(i))
    setError(null)
    startTransition(async () => {
      const res = await applyMenuPatchAction(slug, menuId, picked)
      if ('error' in res) {
        setError(res.error)
        return
      }
      router.refresh()
      setStep({
        kind: 'done',
        stats: {
          addedItems: res.stats.addedItems,
          updatedItems: res.stats.updatedItems,
          removedItems: res.stats.removedItems,
        },
      })
    })
  }

  // Capture-step input handler shared by camera + file.
  function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onPickFile(file)
    event.target.value = ''
  }

  // Build the *proposed* menu tree — the operator sees the WHOLE menu
  // after applying the selected ops, with diff markers per row. Same
  // shape as the Import preview (categories → items) so both flows
  // read as one vocabulary; the difference is just the marker glyphs.
  //
  // Recomputed every render: toggling a checkbox flips opIndex
  // inclusion and the tree rebuilds. Unchanged rows render as muted
  // so the operator confirms what STAYS, not just what changes.
  const proposed = buildProposedTree(
    current,
    step.kind === 'preview' ? step.operations : [],
    step.kind === 'preview' ? step.selectedIndexes : new Set<number>(),
  )

  const summary = step.kind === 'preview'
    ? {
        added: step.operations.filter((op, i) =>
          step.selectedIndexes.has(i) && (op.kind === 'add-item' || op.kind === 'add-category')).length,
        updated: step.operations.filter((op, i) =>
          step.selectedIndexes.has(i) && (op.kind === 'update-item' || op.kind === 'rename-category')).length,
        removed: step.operations.filter((op, i) =>
          step.selectedIndexes.has(i) && (op.kind === 'remove-item' || op.kind === 'remove-category')).length,
      }
    : { added: 0, updated: 0, removed: 0 }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="solid"
          data-test-id="update-menu-trigger"
        >
          {t('updateMenu')}
        </Button>
      </DialogTrigger>

      <DialogContent eyebrow="Menu · AI update">
        {step.kind === 'capture' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('updateMenuTitle')}</DialogTitle>
              <DialogDescription>
                {t('updateMenuDescription')}
              </DialogDescription>
            </DialogHeader>

            <input
              ref={uploadRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-test-id="update-menu-upload-input"
              onChange={handlePicked}
            />

            {pending ? (
              <BuildingAnimation />
            ) : (
              <>
                <OrnamentRule fleuron="❧" />
                <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
                  <ActionCard
                    glyph="◉"
                    title={t('updateMenuTakePhoto')}
                    hint={t('updateMenuTakePhotoHint')}
                    onClick={() => setStep({ kind: 'camera' })}
                    data-test-id="update-menu-take-photo"
                  />
                  <ActionCard
                    glyph="❧"
                    title={t('updateMenuUploadPhoto')}
                    hint={t('updateMenuUploadPhotoHint')}
                    onClick={() => uploadRef.current?.click()}
                    data-test-id="update-menu-upload-photo"
                  />
                </div>
              </>
            )}

            {error && (
              <p
                className="text-sm text-[var(--cinnabar)]"
                data-test-id="update-menu-error"
              >
                {error}
              </p>
            )}
          </>
        )}

        {step.kind === 'camera' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('updateMenuTitle')}</DialogTitle>
            </DialogHeader>
            <CameraCapture
              onCapture={(file) => onPickFile(file)}
              onCancel={() => setStep({ kind: 'capture' })}
            />
          </>
        )}

        {step.kind === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('updateMenuReview')}</DialogTitle>
              <DialogDescription>
                {step.operations.length === 0
                  ? t('updateMenuNoChanges')
                  : t('updateMenuReviewDescription', {
                      changes: step.operations.length,
                    })}
              </DialogDescription>
            </DialogHeader>

            {/* Diff summary — mono pip · count rows, monoline meter. */}
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] uppercase tracking-[0.18em] font-[family-name:var(--mono)]"
              data-test-id="update-menu-summary"
            >
              <span className="inline-flex items-center gap-1.5 text-[var(--cinnabar)]">
                <span aria-hidden="true">+</span>
                {summary.added} {t('updateMenuSummaryAdded')}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[var(--ink-70)]">
                <span aria-hidden="true">~</span>
                {summary.updated} {t('updateMenuSummaryUpdated')}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[var(--ink-55)]">
                <span aria-hidden="true">−</span>
                {summary.removed} {t('updateMenuSummaryRemoved')}
              </span>
            </div>

            {/* Mobile-first menu tree. Each row stacks name + price on a
                full-width line (no horizontal price column to wrap) — the
                whole list is single-column with generous tap targets. */}
            <div
              className="max-h-[60vh] overflow-y-auto -mx-2 sm:mx-0"
              data-test-id="update-menu-preview-tree"
            >
              {proposed.map((cat) => {
                const isRemovedCat = cat.state === 'removed'
                return (
                  <section
                    key={cat.rowKey}
                    className="border-b border-[var(--rule)] last:border-b-0"
                    data-test-id={`update-menu-cat-${cat.rowKey}`}
                    data-state={cat.state}
                  >
                    {/* Section title — Lora italic, marker glyph on changed cats. */}
                    <header className="flex items-center gap-2 px-3 pt-4 pb-2 sm:px-4">
                      {cat.opIndex !== null && (
                        <Checkbox
                          checked={step.selectedIndexes.has(cat.opIndex)}
                          onChange={() => toggleOp(cat.opIndex!)}
                          aria-label={`Include category ${cat.name}`}
                        >{' '}</Checkbox>
                      )}
                      <DiffMarker state={cat.state} />
                      <h3
                        className={
                          'flex-1 min-w-0 text-base italic ' +
                          (isRemovedCat
                            ? 'line-through text-[var(--ink-55)]'
                            : 'text-[var(--ink)]')
                        }
                        style={{ fontFamily: 'var(--serif)' }}
                      >
                        {cat.name}
                        {cat.original && cat.original.name !== cat.name && (
                          <span className="ml-2 not-italic text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)] font-[family-name:var(--mono)]">
                            ← {cat.original.name}
                          </span>
                        )}
                      </h3>
                    </header>

                    {/* Items — each row is mobile-first: name above, price + meta below. */}
                    <ul className="divide-y divide-[var(--rule-2)]">
                      {cat.items.map((it) => {
                        const isRemoved = it.state === 'removed' || isRemovedCat
                        const isAdded = it.state === 'added'
                        const isUpdated = it.state === 'updated'
                        const isInteractive = it.opIndex !== null && !isRemovedCat

                        return (
                          <li
                            key={it.rowKey}
                            className={
                              'flex items-start gap-3 px-3 py-3 min-h-[52px] sm:px-4 ' +
                              (isAdded
                                ? 'bg-[var(--cinnabar-08)]'
                                : isUpdated
                                  ? 'bg-[var(--paper-2)]'
                                  : '')
                            }
                            data-test-id={`update-menu-item-${it.rowKey}`}
                            data-state={it.state}
                          >
                            {/* Checkbox column — only for items that have a
                                controlling op. Reserves a fixed gutter so
                                unchanged rows align under the same name column. */}
                            <div className="pt-0.5 w-6 shrink-0 flex justify-center">
                              {isInteractive ? (
                                <Checkbox
                                  checked={step.selectedIndexes.has(it.opIndex!)}
                                  onChange={() => toggleOp(it.opIndex!)}
                                  aria-label={`Include ${it.name}`}
                                >{' '}</Checkbox>
                              ) : (
                                <DiffMarker state={it.state} />
                              )}
                            </div>

                            <div className="flex-1 min-w-0 space-y-1">
                              {/* Name row */}
                              <div className="flex items-center gap-2 min-w-0">
                                {isInteractive && (
                                  <DiffMarker state={it.state} />
                                )}
                                <p
                                  className={
                                    'text-sm font-medium truncate ' +
                                    (isRemoved
                                      ? 'line-through text-[var(--ink-55)]'
                                      : 'text-[var(--ink)]')
                                  }
                                >
                                  {it.name}
                                </p>
                                {it.original && it.original.name !== it.name && (
                                  <span className="text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)] font-[family-name:var(--mono)] truncate">
                                    ← {it.original.name}
                                  </span>
                                )}
                              </div>

                              {/* Price row — full-width, mono numerals.
                                  Old → New shown inline when updated. */}
                              <div className="flex items-center gap-2 text-xs text-[var(--ink-70)] font-[family-name:var(--mono)] tabular-nums">
                                {it.original && it.original.priceCents !== it.priceCents ? (
                                  <>
                                    <span className="text-[var(--muted)] line-through">
                                      {formatPrice(it.original.priceCents, current.currency)}
                                    </span>
                                    <span aria-hidden="true">→</span>
                                    <span className="text-[var(--ink)]">
                                      {formatPrice(it.priceCents, current.currency)}
                                    </span>
                                  </>
                                ) : (
                                  <span
                                    className={
                                      isRemoved
                                        ? 'line-through text-[var(--muted)]'
                                        : ''
                                    }
                                  >
                                    {formatPrice(it.priceCents, current.currency)}
                                  </span>
                                )}
                              </div>

                              {it.description && (
                                <p
                                  className={
                                    'text-xs italic ' +
                                    (isRemoved
                                      ? 'text-[var(--ink-40)]'
                                      : 'text-[var(--ink-55)]')
                                  }
                                  style={{ fontFamily: 'var(--serif)' }}
                                >
                                  {it.description}
                                </p>
                              )}

                              {/* Variants row — half-dose / sizes /
                                  carafes. Indented with the same arrow
                                  glyph as the import wizard so both
                                  flows read identically. Mobile-first
                                  vertical stack: label left, price
                                  right, mono tabular. */}
                              {(it.variants && it.variants.length > 0) ||
                              (it.original?.variants && it.original.variants.length > 0) ? (
                                <ul
                                  className="space-y-0.5 pl-3"
                                  data-test-id={`update-menu-item-variants-${it.rowKey}`}
                                >
                                  {(it.variants ?? []).map((v, vi) => {
                                    const ov = it.original?.variants?.find(
                                      (x) => x.label === v.label,
                                    )
                                    const priceChanged = ov && ov.priceCents !== v.priceCents
                                    return (
                                      <li
                                        key={`v:${vi}:${v.label}`}
                                        className="flex items-center gap-2 text-xs font-[family-name:var(--mono)] tabular-nums"
                                      >
                                        <span aria-hidden="true" className="text-[var(--muted-2)]">↳</span>
                                        <span
                                          className={
                                            isRemoved
                                              ? 'line-through text-[var(--muted)]'
                                              : 'text-[var(--ink-70)]'
                                          }
                                        >
                                          {v.label}
                                        </span>
                                        <span aria-hidden="true" className="text-[var(--muted-2)]">·</span>
                                        {priceChanged ? (
                                          <>
                                            <span className="line-through text-[var(--muted)]">
                                              {formatPrice(ov!.priceCents, current.currency)}
                                            </span>
                                            <span aria-hidden="true">→</span>
                                            <span className="text-[var(--ink)]">
                                              {formatPrice(v.priceCents, current.currency)}
                                            </span>
                                          </>
                                        ) : (
                                          <span
                                            className={
                                              isRemoved
                                                ? 'line-through text-[var(--muted)]'
                                                : 'text-[var(--ink-70)]'
                                            }
                                          >
                                            {formatPrice(v.priceCents, current.currency)}
                                          </span>
                                        )}
                                      </li>
                                    )
                                  })}
                                  {/* Variants present in the original but
                                      missing from the proposed set →
                                      strikethrough below the live ones. */}
                                  {(it.original?.variants ?? [])
                                    .filter(
                                      (ov) =>
                                        !(it.variants ?? []).some(
                                          (v) => v.label === ov.label,
                                        ),
                                    )
                                    .map((ov, vi) => (
                                      <li
                                        key={`v:removed:${vi}:${ov.label}`}
                                        className="flex items-center gap-2 text-xs font-[family-name:var(--mono)] tabular-nums text-[var(--muted)]"
                                      >
                                        <span aria-hidden="true" className="text-[var(--cinnabar)]">−</span>
                                        <span className="line-through">{ov.label}</span>
                                        <span aria-hidden="true">·</span>
                                        <span className="line-through">
                                          {formatPrice(ov.priceCents, current.currency)}
                                        </span>
                                      </li>
                                    ))}
                                </ul>
                              ) : null}
                            </div>
                          </li>
                        )
                      })}

                      {cat.items.length === 0 && (
                        <li className="px-3 py-3 text-xs italic text-[var(--ink-55)] sm:px-4">
                          {t('updateMenuEmptyCategory')}
                        </li>
                      )}
                    </ul>
                  </section>
                )
              })}
            </div>

            {error && (
              <p
                className="text-sm text-[var(--cinnabar)]"
                data-test-id="update-menu-error"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                disabled={pending}
              >
                {t('updateMenuRetry')}
              </Button>
              <Button
                type="button"
                variant="solid"
                onClick={onApply}
                disabled={pending || step.selectedIndexes.size === 0}
                data-test-id="update-menu-apply"
              >
                {pending
                  ? t('updateMenuApplying')
                  : t('updateMenuApply', { count: step.selectedIndexes.size })}
              </Button>
            </DialogFooter>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('updateMenuDoneTitle')}</DialogTitle>
              <DialogDescription>
                {t('updateMenuDoneDescription', {
                  added: step.stats.addedItems,
                  updated: step.stats.updatedItems,
                  removed: step.stats.removedItems,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="solid"
                onClick={() => onOpenChange(false)}
                data-test-id="update-menu-close"
              >
                {t('updateMenuDone')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
