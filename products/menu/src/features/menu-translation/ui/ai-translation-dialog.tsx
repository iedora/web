'use client'

import { useEffect, useState, useTransition } from 'react'
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
import { LANGUAGE_META, type LanguageCode } from '@/features/i18n'
import { refreshTranslationsAction } from '../actions'
import type { RefreshResult } from '../use-cases/refresh-translations'

/**
 * Editorial "building" sequence that cycles through translation-themed
 * copy while the AI call is in flight. Same trick as the menu-import
 * wizard: `key={index}` remounts the line so the fade animation fires
 * each tick. A cinnabar dot pulses for liveness.
 */
const BUILDING_KEYS = [
  'aiTranslationBuilding1',
  'aiTranslationBuilding2',
  'aiTranslationBuilding3',
  'aiTranslationBuilding4',
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
      data-test-id="ai-translation-progress"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cinnabar)] ds-pulse"
      />
      <p
        key={index}
        className="text-base italic text-[var(--ink)] menu-import-building-line"
        data-test-id={`ai-translation-building-${index}`}
        style={{ fontFamily: 'var(--serif)' }}
      >
        {t(BUILDING_KEYS[index]!)}
      </p>
    </div>
  )
}

/**
 * AI Translation feature. Opens a dialog where the operator picks the
 * target languages (defaults to every supported language except the
 * restaurant's default), then runs the action under an animated
 * progress so the wait reads like deliberate work rather than a frozen
 * spinner. Mirrors the menu-import wizard's pattern so operators see
 * the same vocabulary across the two AI surfaces.
 *
 * Props are server-provided: `defaultLanguage` is omitted from the
 * picker; every other entry in `supportedLanguages` becomes an option.
 */
export function AiTranslationDialog({
  slug,
  defaultLanguage,
  supportedLanguages,
}: {
  slug: string
  defaultLanguage: LanguageCode
  supportedLanguages: ReadonlyArray<LanguageCode>
}) {
  const t = useTranslations('Restaurant')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<RefreshResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Targetable languages = everything supported except the default. If
  // there's only the default, the operator needs to add another via
  // Settings first.
  const targetable = supportedLanguages.filter((l) => l !== defaultLanguage)

  // Picker state: default to all targetable languages selected so the
  // common case (operator just hits Translate) does the obvious thing.
  const [picks, setPicks] = useState<Set<LanguageCode>>(
    () => new Set(targetable),
  )

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setResult(null)
      setError(null)
      setPicks(new Set(targetable))
    }
  }

  function togglePick(lang: LanguageCode) {
    setPicks((prev) => {
      const next = new Set(prev)
      if (next.has(lang)) next.delete(lang)
      else next.add(lang)
      return next
    })
  }

  function onTranslate() {
    if (picks.size === 0) return
    setError(null)
    setResult(null)
    const targets = Array.from(picks)
    startTransition(async () => {
      try {
        const res = await refreshTranslationsAction(slug, {
          targetLanguages: targets,
        })
        setResult(res)
        if (res.ok) router.refresh()
      } catch (err) {
        console.error('[ai-translation] action threw', err)
        setError(t('aiTranslationError'))
      }
    })
  }

  // Look up a friendly label per language for the picker.
  const labelFor = (code: LanguageCode) =>
    LANGUAGE_META.find((l) => l.code === code)?.nativeName ?? code

  const hasTargetable = targetable.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="solid"
          data-test-id="ai-translation-trigger"
        >
          {t('aiTranslation')}
        </Button>
      </DialogTrigger>

      <DialogContent eyebrow="Menu · AI translation">
        <DialogHeader>
          <DialogTitle>{t('aiTranslationTitle')}</DialogTitle>
          <DialogDescription>
            {hasTargetable
              ? t('aiTranslationDescription')
              : t('aiTranslationNoTargets')}
          </DialogDescription>
        </DialogHeader>

        {/* While a call is in flight, the picker disappears and the
            animation takes the whole content area. Pre-call and after
            we show the picker + result feedback. */}
        {pending ? (
          <BuildingAnimation />
        ) : (
          <div className="space-y-4 py-2">
            {hasTargetable && (
              <ul
                className="space-y-2"
                data-test-id="ai-translation-language-list"
              >
                {targetable.map((lang) => {
                  const checked = picks.has(lang)
                  return (
                    <li key={lang}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onChange={() => togglePick(lang)}
                          aria-label={labelFor(lang)}
                          data-test-id={`ai-translation-lang-${lang}`}
                        >{' '}</Checkbox>
                        <span className="text-sm">
                          <span className="font-medium">{labelFor(lang)}</span>
                          <span className="ml-2 text-[10.5px] uppercase tracking-[0.18em] font-[family-name:var(--mono)] text-[var(--ink-55)]">
                            {lang.toUpperCase()}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}

            {result?.ok && (
              <p
                className="text-sm text-[var(--ink-55)]"
                data-test-id="ai-translation-success"
              >
                {t('aiTranslationSuccess', {
                  rows: result.staleRows,
                  languages: result.targetLanguages
                    .map((l) => l.toUpperCase())
                    .join(', '),
                })}
              </p>
            )}
            {result && !result.ok && result.reason === 'nothing-stale' && (
              <p
                className="text-sm text-[var(--ink-55)]"
                data-test-id="ai-translation-up-to-date"
              >
                {t('aiTranslationUpToDate')}
              </p>
            )}
            {result && !result.ok && result.reason === 'translator-failed' && (
              <p
                className="text-sm text-[var(--cinnabar)]"
                data-test-id="ai-translation-translator-failed"
              >
                {t('aiTranslationTranslatorFailed', {
                  languages: result.failedLanguages
                    .map((l) => l.toUpperCase())
                    .join(', '),
                })}
              </p>
            )}
            {error && (
              <p
                className="text-sm text-[var(--cinnabar)]"
                data-test-id="ai-translation-error"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            data-test-id="ai-translation-close"
          >
            {result?.ok ? t('aiTranslationDone') : t('aiTranslationCancel')}
          </Button>
          {hasTargetable && !result?.ok && (
            <Button
              type="button"
              variant="solid"
              onClick={onTranslate}
              disabled={pending || picks.size === 0}
              data-test-id="ai-translation-confirm"
            >
              {pending
                ? t('aiTranslationPending')
                : t('aiTranslationTranslate', { count: picks.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
