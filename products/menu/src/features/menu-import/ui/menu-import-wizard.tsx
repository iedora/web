'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import {
  ActionCard,
  Button,
  Checkbox,
  Field,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import type { LanguageCode } from '../../i18n'
import { requestUploadUrl, commitAsset } from '../../upload/actions'
import type {
  ParsedCategory,
  ParsedItem,
  ParsedVariant,
  ParseMenuErrorCode,
} from '../ports'
import { analyzeMenuImage, importMenuFromParsed } from '../actions'
import { CameraCapture } from './camera-capture'

/**
 * Editorial copy that cycles while the AI analyses the photo. Reads as
 * craft-in-progress rather than a spinner; one i18n key per step so the
 * cadence stays in the operator's language.
 */
const BUILDING_KEYS = [
  'importMenuBuilding1',
  'importMenuBuilding2',
  'importMenuBuilding3',
  'importMenuBuilding4',
] as const

const BUILDING_STEP_MS = 2400

/**
 * Items the AI flagged below this confidence get a visible cue in the
 * preview so the operator double-checks them before persisting. 0.7 is
 * a deliberate "AI hesitated" threshold — high enough that clear, well-lit
 * menus don't trip it, low enough that anything genuinely ambiguous does.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.7

// Mirrors targets.ts — kept local so the wizard can render inline hints
// without reaching across slice boundaries.
const IMPORT_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const IMPORT_PHOTO_ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Two-step AI menu import primitive. Reusable across surfaces:
 *
 *   • `<ImportMenuDialog>` wraps it in a Radix dialog with a confirmation
 *     step that opens the new menu in the builder.
 *   • The onboarding `/onboarding/menu/[slug]` page composes it inline
 *     with a "Skip" CTA and redirects to /dashboard on success.
 *
 * The wizard owns:
 *   - upload + presign + S3 PUT + commit
 *   - Gemini call via `analyzeMenuImage`
 *   - editable preview state (include flag, per-item price edits, menu name)
 *   - `importMenuFromParsed` call
 *
 * It does NOT own:
 *   - the surrounding chrome (dialog/page/etc.)
 *   - what happens after success — the consumer's `onImported(menuId)`
 *     callback is fired once the menu is persisted, and the consumer
 *     decides whether to navigate, close a dialog, etc.
 *
 * Visible UI strings come from `Restaurant.importMenu*` (existing keys);
 * test-ids use the hyphenated cross-product form.
 */

type Step =
  | { kind: 'upload' }
  | { kind: 'camera' }
  | { kind: 'preview'; imageUrl: string }

type EditableItem = ParsedItem & { include: boolean }
type EditableCategory = { name: string; items: EditableItem[] }

function toEditable(categories: ParsedCategory[]): EditableCategory[] {
  return categories.map((c) => ({
    name: c.name,
    items: c.items.map((it) => ({ ...it, include: true })),
  }))
}

function toFinal(categories: EditableCategory[]): ParsedCategory[] {
  return categories
    .map((c) => ({
      name: c.name,
      items: c.items
        .filter((it) => it.include)
        .map(({ include: _omit, variants, ...rest }) => {
          // Drop blank-label variants the operator may have added and
          // never filled. Don't persist empty `variants: []` arrays —
          // keep the JSON tidy.
          const kept = variants?.filter((v) => v.label.trim().length > 0)
          return kept && kept.length > 0
            ? { ...rest, variants: kept }
            : rest
        }),
    }))
    .filter((c) => c.items.length > 0)
}

function formatPrice(priceCents: number, currency: string | null): string {
  if (priceCents === 0) return '—'
  const amount = priceCents / 100
  if (currency && currency.length === 3) {
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
      }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }
  return `€${amount.toFixed(2)}`
}

function parsePriceCents(raw: string): number {
  const n = Number(raw.replace(',', '.'))
  if (Number.isNaN(n) || n < 0) return 0
  return Math.round(n * 100)
}

/**
 * Maps an AI error code to the i18n key the wizard renders. Provider
 * billing language, retry counts, and raw exception strings never reach
 * the UI — operators see calm, localized copy.
 */
function errorKeyForCode(code: ParseMenuErrorCode): string {
  switch (code) {
    case 'quota':
      return 'importMenuErrorQuota'
    case 'auth':
      return 'importMenuErrorAuth'
    case 'network':
      return 'importMenuErrorNetwork'
    case 'parse':
      return 'importMenuErrorParse'
    case 'truncated':
      return 'importMenuErrorTruncated'
    case 'unknown':
    default:
      return 'importMenuErrorUnknown'
  }
}

/**
 * Cycles through editorial "building" copy while the AI runs. Renders
 * each line for `BUILDING_STEP_MS` then advances; the `key` change on
 * the <p> remounts the node so the fade-in CSS triggers each time. The
 * cinnabar dot pulses to signal liveness.
 */
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
      data-test-id="menu-import-pending"
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cinnabar)] ds-pulse"
      />
      <p
        key={index}
        className="text-base italic text-[var(--ink)] menu-import-building-line"
        data-test-id={`menu-import-building-${index}`}
        style={{ fontFamily: 'var(--serif)' }}
      >
        {t(BUILDING_KEYS[index]!)}
      </p>
    </div>
  )
}

export type MenuImportWizardProps = {
  slug: string
  restaurantId: string
  /**
   * Fired once the menu has been persisted. The consumer decides what
   * to do next — open the menu in the builder, redirect to /dashboard,
   * close a wrapping dialog, etc.
   */
  onImported: (menuId: string) => void
  /**
   * Optional extra controls rendered next to the primary "Import" CTA.
   * Used by onboarding to add a "Skip" button.
   */
  extraActions?: React.ReactNode
  /**
   * Optional snapshot of the org's AI quota at page-load time. When set,
   * the wizard renders a "X of N this week" hint on the upload step so
   * operators see the limit before they pick a file. The server returns
   * a fresh snapshot after each analyse — the prop is only the seed.
   */
  initialQuota?: { used: number; limit: number }
  /**
   * When true, the preview renders an opt-in checkbox offering to use
   * the AI-detected language as the restaurant's default. Pre-checked
   * (sensible default for the onboarding flow), but the operator has to
   * affirmatively keep it checked to mutate the restaurant row — no
   * silent writes. The per-restaurant dialog leaves this off entirely
   * since the operator has already configured their restaurant.
   */
  offerSetDefaultLanguage?: boolean
}

type QuotaSnapshot = { used: number; limit: number }
type Detected = { language: LanguageCode; currency: string }

export function MenuImportWizard({
  slug,
  restaurantId,
  onImported,
  extraActions,
  initialQuota,
  offerSetDefaultLanguage = false,
}: MenuImportWizardProps) {
  const t = useTranslations('Restaurant')
  // Hidden file input for the "Upload from device" path. The "Take a
  // photo" path uses `getUserMedia` (see `<CameraCapture>`) so the same
  // capture UX works on phone, tablet, and desktop without any
  // platform-specific branches.
  const uploadRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'upload' })
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editable, setEditable] = useState<EditableCategory[]>([])
  const [menuName, setMenuName] = useState('')
  const [quota, setQuota] = useState<QuotaSnapshot | null>(initialQuota ?? null)
  const [detected, setDetected] = useState<Detected | null>(null)

  function reset() {
    setStep({ kind: 'upload' })
    setError(null)
    setEditable([])
    setMenuName('')
  }

  // ─── Upload + AI analyse ─────────────────────────────────────────────

  function onPickFile(file: File) {
    setError(null)

    const mimeOk = IMPORT_PHOTO_ACCEPTED_MIME.includes(file.type as never)
    if (!mimeOk) {
      setError('Unsupported file type. Use JPEG, PNG, or WebP.')
      return
    }
    if (file.size > IMPORT_PHOTO_MAX_BYTES) {
      setError(
        `File too large. Max ${(IMPORT_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB.`,
      )
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

      const analysis = await analyzeMenuImage(slug, presign.data.publicUrl)
      if ('error' in analysis) {
        // Two error families:
        //   - `reason: 'ai-weekly-limit'` is the plan quota gate. Surface
        //     the over-quota copy directly (it already references the
        //     upgrade path, no provider details leak).
        //   - Otherwise it's an AI-provider error with a coarse `code`;
        //     the wizard renders the localized fallback for that code.
        if ('reason' in analysis && analysis.reason === 'ai-weekly-limit') {
          setError(analysis.error)
        } else if ('code' in analysis) {
          setError(t(errorKeyForCode(analysis.code)))
        } else {
          setError(t('importMenuErrorUnknown'))
        }
        return
      }

      const today = new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      setEditable(toEditable(analysis.categories))
      setMenuName(`Imported – ${today}`)
      setQuota(analysis.quota)
      setDetected({ language: analysis.language, currency: analysis.currency })
      setStep({ kind: 'preview', imageUrl: presign.data.publicUrl })
    })
  }

  // ─── Preview edits ───────────────────────────────────────────────────

  function toggleItem(catIdx: number, itemIdx: number) {
    setEditable((prev) =>
      prev.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              items: c.items.map((it, ii) =>
                ii !== itemIdx ? it : { ...it, include: !it.include },
              ),
            },
      ),
    )
  }

  function updatePrice(catIdx: number, itemIdx: number, raw: string) {
    const priceCents = parsePriceCents(raw)
    // Don't touch `available` — a 0-cent price is a free item, not
    // an unavailable one. Operators flip availability later via the
    // menu builder.
    setEditable((prev) =>
      prev.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              items: c.items.map((it, ii) =>
                ii !== itemIdx ? it : { ...it, priceCents },
              ),
            },
      ),
    )
  }

  function patchVariant(
    catIdx: number,
    itemIdx: number,
    varIdx: number,
    patch: Partial<ParsedVariant>,
  ) {
    setEditable((prev) =>
      prev.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              items: c.items.map((it, ii) =>
                ii !== itemIdx
                  ? it
                  : {
                      ...it,
                      variants: (it.variants ?? []).map((v, vi) =>
                        vi !== varIdx ? v : { ...v, ...patch },
                      ),
                    },
              ),
            },
      ),
    )
  }

  function addVariant(catIdx: number, itemIdx: number) {
    setEditable((prev) =>
      prev.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              items: c.items.map((it, ii) =>
                ii !== itemIdx
                  ? it
                  : {
                      ...it,
                      variants: [
                        ...(it.variants ?? []),
                        { label: '', priceCents: 0 },
                      ],
                    },
              ),
            },
      ),
    )
  }

  function removeVariant(catIdx: number, itemIdx: number, varIdx: number) {
    setEditable((prev) =>
      prev.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              items: c.items.map((it, ii) =>
                ii !== itemIdx
                  ? it
                  : {
                      ...it,
                      variants: (it.variants ?? []).filter(
                        (_, vi) => vi !== varIdx,
                      ),
                    },
              ),
            },
      ),
    )
  }

  function onImport() {
    const final = toFinal(editable)
    if (final.length === 0) {
      setError('Select at least one item to import.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await importMenuFromParsed(
        slug,
        menuName || 'Imported menu',
        final,
        offerSetDefaultLanguage && detected
          ? { setDefaultLanguage: detected.language }
          : undefined,
      )
      if ('error' in res) { setError(res.error); return }
      onImported(res.menuId)
    })
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (step.kind === 'camera') {
    return (
      <div className="space-y-4" data-test-id="menu-import-wizard-camera">
        <CameraCapture
          onCapture={(file) => onPickFile(file)}
          onCancel={() => setStep({ kind: 'upload' })}
        />

        {quota && (
          <p
            className="text-center text-xs uppercase tracking-[0.16em] text-[var(--ink-55)] font-[family-name:var(--mono)]"
            data-test-id="menu-import-quota"
          >
            {t('importMenuQuota', { used: quota.used, limit: quota.limit })}
          </p>
        )}

        {error && (
          <p
            className="text-sm text-[var(--cinnabar)]"
            data-test-id="menu-import-error"
          >
            {error}
          </p>
        )}
      </div>
    )
  }

  if (step.kind === 'upload') {
    const remaining = quota
      ? Math.max(0, quota.limit - quota.used)
      : null
    const disabled = pending || remaining === 0

    function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0]
      if (file) onPickFile(file)
      event.target.value = ''
    }

    return (
      <div className="space-y-4" data-test-id="menu-import-wizard-upload">
        {/* The upload path keeps a hidden file input. The camera path
            opens a `getUserMedia` preview inside the wizard (same code
            path on phone, tablet, and desktop — no `<input capture>` /
            platform branching). */}
        <input
          ref={uploadRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-test-id="menu-import-upload-input"
          onChange={handlePicked}
        />

        {pending ? (
          <BuildingAnimation />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionCard
              disabled={disabled}
              glyph="◉"
              title={t('importMenuTakePhoto')}
              hint={t('importMenuTakePhotoHint')}
              onClick={() => setStep({ kind: 'camera' })}
              data-test-id="menu-import-take-photo"
            />
            <ActionCard
              disabled={disabled}
              glyph="❧"
              title={t('importMenuUploadPhoto')}
              hint={t('importMenuUploadPhotoHint')}
              onClick={() => uploadRef.current?.click()}
              data-test-id="menu-import-upload-photo"
            />
          </div>
        )}

        {quota && (
          <p
            className="text-center text-xs uppercase tracking-[0.16em] text-[var(--ink-55)] font-[family-name:var(--mono)]"
            data-test-id="menu-import-quota"
          >
            {t('importMenuQuota', { used: quota.used, limit: quota.limit })}
          </p>
        )}

        {error && (
          <p
            className="text-sm text-[var(--cinnabar)]"
            data-test-id="menu-import-error"
          >
            {error}
          </p>
        )}

        {extraActions && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {extraActions}
          </div>
        )}
      </div>
    )
  }

  // Preview step
  const includedCount = editable.reduce(
    (n, c) => n + c.items.filter((i) => i.include).length,
    0,
  )

  const detectedCurrency = detected?.currency || null

  return (
    <div className="space-y-4" data-test-id="menu-import-wizard-preview">
      <div className="space-y-1">
        <p className="text-sm text-[var(--ink-55)]">
          {t('importMenuReviewDescription', {
            items: includedCount,
            categories: editable.length,
          })}
        </p>
        {detected && (
          <p
            className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)] font-[family-name:var(--mono)]"
            data-test-id="menu-import-detected"
          >
            {t('importMenuDetected', {
              language: detected.language.toUpperCase(),
              currency: detected.currency || '—',
            })}
          </p>
        )}
      </div>

      {offerSetDefaultLanguage && detected && (
        // Info hint, not a control. When the wizard runs from the
        // onboarding flow (the restaurant has no menus yet), the AI's
        // detected language becomes the restaurant's default on
        // Import — no confirmation needed, no checkbox to miss. The
        // operator can still flip it later in Settings.
        <p
          className="text-xs text-[var(--ink-55)]"
          data-test-id="menu-import-apply-language-note"
        >
          {t('importMenuApplyLanguageNote', {
            language: detected.language.toUpperCase(),
          })}
        </p>
      )}

      <Field>
        <FieldLabel htmlFor="menu-import-name">
          {t('importMenuName')}
        </FieldLabel>
        <FieldInput
          id="menu-import-name"
          value={menuName}
          onChange={(e) => setMenuName(e.target.value)}
          maxLength={80}
          data-test-id="menu-import-name-input"
        />
      </Field>

      <div
        className="max-h-96 overflow-y-auto rounded-lg border border-[var(--ink-14)] divide-y divide-[var(--ink-14)]"
        data-test-id="menu-import-preview-list"
      >
        {editable.map((cat, catIdx) => (
          <div key={catIdx}>
            <div className="bg-[var(--paper-2)] px-4 py-2">
              <p className="text-sm font-semibold">{cat.name}</p>
            </div>
            {cat.items.map((it, itemIdx) => {
              const lowConfidence = it.confidence < LOW_CONFIDENCE_THRESHOLD
              const variants = it.variants ?? []
              return (
              <div
                key={itemIdx}
                className="px-4 py-2 hover:bg-[var(--paper-2)]"
                data-test-id={`menu-import-item-${catIdx}-${itemIdx}`}
                data-confidence={lowConfidence ? 'low' : 'ok'}
              >
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={it.include}
                  onChange={() => toggleItem(catIdx, itemIdx)}
                  aria-label={`Include ${it.name}`}
                >{' '}</Checkbox>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm truncate">{it.name}</p>
                    {lowConfidence && (
                      <span
                        className="shrink-0 border border-[var(--cinnabar)] px-1 text-[9px] uppercase tracking-[0.18em] text-[var(--cinnabar)] font-[family-name:var(--mono)]"
                        title={t('importMenuReviewTooltip')}
                        data-test-id={`menu-import-item-review-${catIdx}-${itemIdx}`}
                      >
                        {t('importMenuReviewMarker')}
                      </span>
                    )}
                  </div>
                  {it.description && (
                    <p className="text-xs text-[var(--ink-55)] truncate">
                      {it.description}
                    </p>
                  )}
                </div>
                <input
                  type="text"
                  defaultValue={
                    it.priceCents > 0 ? (it.priceCents / 100).toFixed(2) : ''
                  }
                  placeholder="0.00"
                  className="w-20 rounded border border-[var(--ink-14)] bg-transparent px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-[var(--ink-40)]"
                  onBlur={(e) => updatePrice(catIdx, itemIdx, e.target.value)}
                  aria-label={`Price for ${it.name}`}
                  data-test-id={`menu-import-item-price-${catIdx}-${itemIdx}`}
                />
                <span className="w-16 text-right text-xs text-[var(--ink-55)] tabular-nums">
                  {formatPrice(it.priceCents, detectedCurrency)}
                </span>
              </div>

              {/* Variant rows. Indented to align under the item name —
                  faint arrow + editable label + editable price + remove. */}
              {variants.length > 0 && (
                <div
                  className="mt-2 space-y-1 pl-10"
                  data-test-id={`menu-import-item-variants-${catIdx}-${itemIdx}`}
                >
                  {variants.map((v, varIdx) => (
                    <div
                      key={varIdx}
                      className="flex items-center gap-2"
                      data-test-id={`menu-import-variant-${catIdx}-${itemIdx}-${varIdx}`}
                    >
                      <span aria-hidden="true" className="text-[var(--ink-40)] text-xs">
                        ↳
                      </span>
                      <input
                        type="text"
                        value={v.label}
                        onChange={(e) =>
                          patchVariant(catIdx, itemIdx, varIdx, {
                            label: e.target.value,
                          })
                        }
                        placeholder={t('importMenuVariantLabel')}
                        aria-label={t('importMenuVariantLabel')}
                        className="flex-1 min-w-0 rounded border border-[var(--ink-14)] bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--ink-40)]"
                        data-test-id={`menu-import-variant-label-${catIdx}-${itemIdx}-${varIdx}`}
                      />
                      <input
                        type="text"
                        defaultValue={
                          v.priceCents > 0 ? (v.priceCents / 100).toFixed(2) : ''
                        }
                        placeholder="0.00"
                        onBlur={(e) =>
                          patchVariant(catIdx, itemIdx, varIdx, {
                            priceCents: parsePriceCents(e.target.value),
                          })
                        }
                        aria-label={`Price for ${v.label || 'variant'}`}
                        className="w-20 rounded border border-[var(--ink-14)] bg-transparent px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-[var(--ink-40)]"
                        data-test-id={`menu-import-variant-price-${catIdx}-${itemIdx}-${varIdx}`}
                      />
                      <span className="w-16 text-right text-[10px] text-[var(--ink-55)] tabular-nums">
                        {formatPrice(v.priceCents, detectedCurrency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeVariant(catIdx, itemIdx, varIdx)}
                        aria-label={t('importMenuVariantRemove')}
                        title={t('importMenuVariantRemove')}
                        className="text-[var(--ink-40)] hover:text-[var(--cinnabar)] px-1 text-sm leading-none"
                        data-test-id={`menu-import-variant-remove-${catIdx}-${itemIdx}-${varIdx}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => addVariant(catIdx, itemIdx)}
                className="mt-1.5 ml-10 text-[10px] uppercase tracking-[0.18em] font-[family-name:var(--mono)] text-[var(--ink-40)] hover:text-[var(--ink)]"
                data-test-id={`menu-import-add-variant-${catIdx}-${itemIdx}`}
              >
                {t('importMenuAddVariant')}
              </button>
              </div>
              )
            })}
          </div>
        ))}
      </div>

      {error && (
        <p
          className="text-sm text-[var(--cinnabar)]"
          data-test-id="menu-import-error"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          disabled={pending}
          data-test-id="menu-import-back"
        >
          {t('importMenuBack')}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {extraActions}
          <Button
            type="button"
            variant="solid"
            onClick={onImport}
            disabled={pending}
            data-test-id="menu-import-confirm"
          >
            {pending ? t('importMenuImporting') : t('importMenuConfirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
