'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@iedora/design-system'
import { requestUploadUrl, commitAsset } from '@/features/upload/actions'
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

  // Bin ops by kind for the preview render. Categories grouped at the
  // bottom so the operator's eye lands on the item changes first.
  const bins = (() => {
    if (step.kind !== 'preview') return null
    const adds: Array<{ idx: number; op: Extract<PatchOperation, { kind: 'add-item' }> }> = []
    const updates: Array<{ idx: number; op: Extract<PatchOperation, { kind: 'update-item' }> }> = []
    const removes: Array<{ idx: number; op: Extract<PatchOperation, { kind: 'remove-item' }> }> = []
    const catChanges: Array<{
      idx: number
      op: Extract<
        PatchOperation,
        { kind: 'add-category' | 'rename-category' | 'remove-category' }
      >
    }> = []
    step.operations.forEach((op, idx) => {
      if (op.kind === 'add-item') adds.push({ idx, op })
      else if (op.kind === 'update-item') updates.push({ idx, op })
      else if (op.kind === 'remove-item') removes.push({ idx, op })
      else catChanges.push({ idx, op })
    })
    return { adds, updates, removes, catChanges }
  })()

  // Resolver — show item names for update-item / remove-item using the
  // current menu we already have on the client.
  function findItem(itemId: string) {
    for (const c of current.categories) {
      for (const it of c.items) if (it.id === itemId) return it
    }
    return null
  }
  function findCategory(categoryId: string) {
    return current.categories.find((c) => c.id === categoryId) ?? null
  }

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
              <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setStep({ kind: 'camera' })}
                  data-test-id="update-menu-take-photo"
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--ink-24)] p-6 text-center transition-colors hover:border-[var(--ink-40)] hover:bg-[var(--paper-2)]"
                >
                  <span className="text-base font-medium">
                    {t('updateMenuTakePhoto')}
                  </span>
                  <span className="text-xs text-[var(--ink-55)]">
                    {t('updateMenuTakePhotoHint')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  data-test-id="update-menu-upload-photo"
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--ink-24)] p-6 text-center transition-colors hover:border-[var(--ink-40)] hover:bg-[var(--paper-2)]"
                >
                  <span className="text-base font-medium">
                    {t('updateMenuUploadPhoto')}
                  </span>
                  <span className="text-xs text-[var(--ink-55)]">
                    {t('updateMenuUploadPhotoHint')}
                  </span>
                </button>
              </div>
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

        {step.kind === 'preview' && bins && (
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

            <div className="max-h-[60vh] overflow-y-auto space-y-3 py-2">
              {bins.adds.length > 0 && (
                <section data-test-id="update-menu-bin-add">
                  <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--ink-55)] font-[family-name:var(--mono)]">
                    {t('updateMenuBinAdd', { count: bins.adds.length })}
                  </h3>
                  <ul className="divide-y divide-[var(--ink-14)] border border-[var(--ink-14)] rounded-lg">
                    {bins.adds.map(({ idx, op }) => (
                      <li
                        key={idx}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <Checkbox
                          checked={step.selectedIndexes.has(idx)}
                          onChange={() => toggleOp(idx)}
                          aria-label={`Include ${op.name}`}
                        >{' '}</Checkbox>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{op.name}</p>
                          {op.description && (
                            <p className="text-xs text-[var(--ink-55)] truncate">
                              {op.description}
                            </p>
                          )}
                        </div>
                        <span className="text-sm tabular-nums text-[var(--ink)]">
                          {formatPrice(op.priceCents, current.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {bins.updates.length > 0 && (
                <section data-test-id="update-menu-bin-update">
                  <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--ink-55)] font-[family-name:var(--mono)]">
                    {t('updateMenuBinUpdate', { count: bins.updates.length })}
                  </h3>
                  <ul className="divide-y divide-[var(--ink-14)] border border-[var(--ink-14)] rounded-lg">
                    {bins.updates.map(({ idx, op }) => {
                      const existing = findItem(op.itemId)
                      return (
                        <li
                          key={idx}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <Checkbox
                            checked={step.selectedIndexes.has(idx)}
                            onChange={() => toggleOp(idx)}
                            aria-label={`Apply update to ${existing?.name ?? op.itemId}`}
                          >{' '}</Checkbox>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {op.name ?? existing?.name ?? op.itemId}
                            </p>
                            {op.priceCents !== undefined && existing && (
                              <p className="text-xs text-[var(--ink-55)]">
                                {formatPrice(existing.priceCents, current.currency)}
                                {' → '}
                                <span className="text-[var(--ink)] font-medium">
                                  {formatPrice(op.priceCents, current.currency)}
                                </span>
                              </p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {bins.removes.length > 0 && (
                <section data-test-id="update-menu-bin-remove">
                  <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--cinnabar)] font-[family-name:var(--mono)]">
                    {t('updateMenuBinRemove', { count: bins.removes.length })}
                  </h3>
                  <ul className="divide-y divide-[var(--ink-14)] border border-[var(--ink-14)] rounded-lg">
                    {bins.removes.map(({ idx, op }) => {
                      const existing = findItem(op.itemId)
                      return (
                        <li
                          key={idx}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <Checkbox
                            checked={step.selectedIndexes.has(idx)}
                            onChange={() => toggleOp(idx)}
                            aria-label={`Remove ${existing?.name ?? op.itemId}`}
                          >{' '}</Checkbox>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate line-through text-[var(--ink-55)]">
                              {existing?.name ?? op.itemId}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {bins.catChanges.length > 0 && (
                <section data-test-id="update-menu-bin-categories">
                  <h3 className="mb-1 text-xs uppercase tracking-[0.18em] text-[var(--ink-55)] font-[family-name:var(--mono)]">
                    {t('updateMenuBinCategories', { count: bins.catChanges.length })}
                  </h3>
                  <ul className="divide-y divide-[var(--ink-14)] border border-[var(--ink-14)] rounded-lg">
                    {bins.catChanges.map(({ idx, op }) => {
                      let label = ''
                      if (op.kind === 'add-category') label = `+ ${op.name}`
                      else if (op.kind === 'remove-category')
                        label = `− ${findCategory(op.categoryId)?.name ?? op.categoryId}`
                      else if (op.kind === 'rename-category')
                        label = `${findCategory(op.categoryId)?.name ?? op.categoryId} → ${op.name}`
                      return (
                        <li
                          key={idx}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <Checkbox
                            checked={step.selectedIndexes.has(idx)}
                            onChange={() => toggleOp(idx)}
                            aria-label={label}
                          >{' '}</Checkbox>
                          <p className="text-sm">{label}</p>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
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
