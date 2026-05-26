'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Field,
  FieldHint,
  FieldInput,
  FieldLabel,
  FieldTextarea,
} from '@iedora/design-system'
import { LANGUAGE_META, type LanguageCode, type LocalizedText } from '@/features/i18n'
import type { EditableVariant } from './variants-editor'

/**
 * Translations editor for the dish dialog's Part 3.
 *
 * Why a dedicated component (instead of reusing `LocalizedFields`):
 * `LocalizedFields` handles a generic name+description pair, but the
 * dish dialog also needs to translate every variant *label* in lock-
 * step with the active language tab. Wedging variants into
 * `LocalizedFields` would couple it to the dish concept. Keeping it
 * here lets us own the tab strip + per-variant translation rows
 * without leaking dish-shaped concerns into the i18n slice.
 *
 * Shape:
 *
 *   [Tabs: EN  ES  FR]   ← non-default languages only; default is hidden
 *
 *   Name (translation for EN)
 *   [___________________________]
 *
 *   Description
 *   [___________________________]
 *
 *   Variants
 *   ½ dose      → [_______________]
 *   Sem álcool  → [_______________]
 *
 * Reads source values (`name`, `description`, `variants[].label`) to
 * display alongside each translation field — operators translate from
 * what they see, not what's a tab away.
 */
export function ItemTranslations({
  itemId,
  defaultLanguage,
  supportedLanguages,
  name,
  description,
  variants,
  nameI18n,
  descriptionI18n,
  onNameI18nChange,
  onDescriptionI18nChange,
  onVariantsChange,
}: {
  itemId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  /** Source values — displayed as reference next to each translation. */
  name: string
  description: string
  variants: ReadonlyArray<EditableVariant>
  /** Translation maps + setters for the dish fields. */
  nameI18n: LocalizedText
  descriptionI18n: LocalizedText
  onNameI18nChange: (next: LocalizedText) => void
  onDescriptionI18nChange: (next: LocalizedText) => void
  /** Variants pass through unchanged except for `labelI18n` per row. */
  onVariantsChange: (next: EditableVariant[]) => void
}) {
  const t = useTranslations('Builder')
  const targetLanguages = supportedLanguages.filter(
    (l) => l !== defaultLanguage,
  )
  const [activeLang, setActiveLang] = useState<LanguageCode>(
    targetLanguages[0] ?? defaultLanguage,
  )

  // Defensive: nothing to render if no non-default languages exist.
  // Callers gate on supportedLanguages.length > 1 already; this guards
  // against a future caller forgetting.
  if (targetLanguages.length === 0) return null

  const tNameValue = nameI18n[activeLang] ?? ''
  const tDescriptionValue = descriptionI18n[activeLang] ?? ''

  function setNameTranslation(v: string) {
    onNameI18nChange({ ...nameI18n, [activeLang]: v })
  }
  function setDescriptionTranslation(v: string) {
    onDescriptionI18nChange({ ...descriptionI18n, [activeLang]: v })
  }
  function setVariantLabelTranslation(idx: number, v: string) {
    onVariantsChange(
      variants.map((variant, i) => {
        if (i !== idx) return variant
        const nextI18n: LocalizedText = {
          ...(variant.labelI18n ?? {}),
          [activeLang]: v,
        }
        return { ...variant, labelI18n: nextI18n }
      }),
    )
  }

  // Variants in `value` may include blank/incomplete rows the operator
  // hasn't filled in yet — filter to those with a real source label so
  // the operator doesn't translate empty strings.
  const translatableVariants = variants
    .map((v, idx) => ({ v, idx }))
    .filter(({ v }) => v.label.trim().length > 0)

  return (
    <div className="grid gap-4">
      <LanguageTabs
        languages={targetLanguages}
        defaultLanguage={defaultLanguage}
        activeLang={activeLang}
        onSelect={setActiveLang}
        idPrefix={`item-${itemId}`}
      />

      <Field>
        <FieldLabel htmlFor={`item-${itemId}-tname-${activeLang}`}>
          {t('itemName')}
        </FieldLabel>
        <p className="text-xs text-[var(--ink-55)]">{name || '—'}</p>
        <FieldInput
          id={`item-${itemId}-tname-${activeLang}`}
          data-test-id={`item-${itemId}-tname-${activeLang}`}
          value={tNameValue}
          onChange={(e) => setNameTranslation(e.target.value)}
          placeholder={t('translationPlaceholder', {
            lang: labelFor(activeLang),
          })}
          maxLength={120}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`item-${itemId}-tdesc-${activeLang}`}>
          {t('itemDescription')}
        </FieldLabel>
        <p className="text-xs text-[var(--ink-55)]">{description || '—'}</p>
        <FieldTextarea
          id={`item-${itemId}-tdesc-${activeLang}`}
          data-test-id={`item-${itemId}-tdesc-${activeLang}`}
          value={tDescriptionValue}
          onChange={(e) => setDescriptionTranslation(e.target.value)}
          rows={3}
          placeholder={t('translationPlaceholder', {
            lang: labelFor(activeLang),
          })}
          maxLength={1000}
        />
      </Field>

      {translatableVariants.length > 0 && (
        <Field>
          <FieldLabel>{t('itemVariants')}</FieldLabel>
          <ul className="grid gap-2" data-test-id={`item-${itemId}-tvariants`}>
            {translatableVariants.map(({ v, idx }) => {
              const translation = v.labelI18n?.[activeLang] ?? ''
              return (
                <li
                  key={idx}
                  className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-3"
                >
                  <span
                    className="truncate font-[family-name:var(--serif)] text-sm text-[var(--ink-70)]"
                    title={v.label}
                  >
                    {v.label}
                  </span>
                  <FieldInput
                    compact
                    value={translation}
                    onChange={(e) =>
                      setVariantLabelTranslation(idx, e.target.value)
                    }
                    placeholder={t('translationPlaceholder', {
                      lang: labelFor(activeLang),
                    })}
                    aria-label={t('itemVariantLabelTranslationAria', {
                      label: v.label,
                      lang: labelFor(activeLang),
                    })}
                    data-test-id={`item-${itemId}-tvariant-${idx}-${activeLang}`}
                    maxLength={60}
                  />
                </li>
              )
            })}
          </ul>
          <FieldHint>{t('itemVariantTranslationsHint')}</FieldHint>
        </Field>
      )}
    </div>
  )
}

function labelFor(code: LanguageCode): string {
  return LANGUAGE_META.find((l) => l.code === code)?.nativeName ?? code
}

function LanguageTabs({
  languages,
  defaultLanguage,
  activeLang,
  onSelect,
  idPrefix,
}: {
  languages: LanguageCode[]
  defaultLanguage: LanguageCode
  activeLang: LanguageCode
  onSelect: (next: LanguageCode) => void
  idPrefix: string
}) {
  // Single-language case: no strip needed.
  if (languages.length <= 1) return null
  return (
    <div
      role="tablist"
      aria-label="Translations"
      data-test-id={`${idPrefix}-tabs`}
      className="flex flex-wrap gap-1 border-b border-[var(--ink-14)]"
    >
      {languages.map((code) => {
        const meta = LANGUAGE_META.find((m) => m.code === code)
        if (!meta) return null
        const isActive = activeLang === code
        const isDefault = code === defaultLanguage
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-test-id={`${idPrefix}-tab-${code}`}
            onClick={() => onSelect(code)}
            className={
              'px-3 py-1.5 text-xs ' +
              (isActive
                ? 'border-b-2 border-[var(--ink)] font-medium text-[var(--ink)]'
                : 'text-[var(--ink-55)] hover:text-[var(--ink)]')
            }
          >
            {meta.nativeName}
            {isDefault && (
              <span className="ml-1 font-[family-name:var(--mono)] text-[10px] uppercase tracking-[0.16em] opacity-70">
                default
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
