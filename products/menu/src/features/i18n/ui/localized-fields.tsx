'use client'

import { useState } from 'react'
import {
  Field,
  FieldInput,
  FieldLabel,
  FieldTextarea,
} from '@iedora/design-system'
import { LANGUAGE_META } from '../registry'
import type { LanguageCode, LocalizedText } from '../types'

// Shared 1-or-2-field localized editor. Default-language values stay in
// `name`/`description` (text columns); other languages live in the maps.
// Pass `id` so callers can disambiguate testid namespaces when more than one
// instance lives on the same page.
//
// `showDefault={false}` mode: the tab strip hides the default-language tab
// entirely. The host page is assumed to already edit the source columns
// elsewhere (e.g. a "Basics" section in the dish edit dialog), and this
// component is purely a translations editor. The active tab starts on the
// first non-default language; the default-tab callbacks (onNameChange /
// onDescriptionChange) are never invoked.
//
// SOURCE-OF-TRUTH NOTE: the default-language value lives in `name` /
// `description`. Non-default languages live in `*I18n` maps. If the
// restaurant's `defaultLanguage` is later changed, the maps and source
// columns need to be re-shuffled (see updateLanguageSettings action) so
// the "new default" tab is no longer storing values in the wrong slot.
export function LocalizedFields({
  id,
  defaultLanguage,
  supportedLanguages,
  // Default-language plain text fields.
  name,
  onNameChange,
  description,
  onDescriptionChange,
  // Override maps for non-default languages.
  nameI18n,
  onNameI18nChange,
  descriptionI18n,
  onDescriptionI18nChange,
  nameLabel = 'Name',
  descriptionLabel = 'Description',
  nameRequired = true,
  showName = true,
  showDescription = true,
  showDefault = true,
  nameMaxLength = 120,
  descriptionMaxLength = 1000,
  descriptionRows = 3,
}: {
  id: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  name: string
  onNameChange: (v: string) => void
  description?: string
  onDescriptionChange?: (v: string) => void
  nameI18n: LocalizedText
  onNameI18nChange: (next: LocalizedText) => void
  descriptionI18n?: LocalizedText
  onDescriptionI18nChange?: (next: LocalizedText) => void
  nameLabel?: string
  descriptionLabel?: string
  nameRequired?: boolean
  /**
   * Set false when the host already renders a mono-language name field
   * above (e.g. restaurant identity: name is a proper noun, only the
   * tagline/description needs translation tabs).
   */
  showName?: boolean
  showDescription?: boolean
  /**
   * Set false to hide the default-language tab entirely. Use when the
   * host already edits the source columns elsewhere and this component
   * is purely a translations editor.
   */
  showDefault?: boolean
  nameMaxLength?: number
  descriptionMaxLength?: number
  descriptionRows?: number
}) {
  // Languages actually shown in the tab strip — drops the default when
  // showDefault=false so the operator can't accidentally re-edit the
  // source columns through what looks like a translation tab.
  const visibleLanguages = showDefault
    ? supportedLanguages
    : supportedLanguages.filter((l) => l !== defaultLanguage)

  const initialLang =
    visibleLanguages.find((l) => l === defaultLanguage) ??
    visibleLanguages[0] ??
    defaultLanguage
  const [activeLang, setActiveLang] = useState<LanguageCode>(initialLang)
  // Render nothing when there are no tabs to show (e.g. showDefault=false
  // on a single-language restaurant). Callers should gate on
  // supportedLanguages.length > 1 in this mode, but guard defensively.
  if (visibleLanguages.length === 0) return null
  const showTabs = visibleLanguages.length > 1
  const isDefaultTab = activeLang === defaultLanguage

  const currentName = isDefaultTab ? name : nameI18n[activeLang] ?? ''
  const currentDescription = isDefaultTab
    ? description ?? ''
    : descriptionI18n?.[activeLang] ?? ''

  function handleNameChange(value: string) {
    if (isDefaultTab) {
      onNameChange(value)
    } else {
      onNameI18nChange({ ...nameI18n, [activeLang]: value })
    }
  }

  function handleDescriptionChange(value: string) {
    if (isDefaultTab) {
      onDescriptionChange?.(value)
    } else if (onDescriptionI18nChange) {
      onDescriptionI18nChange({ ...(descriptionI18n ?? {}), [activeLang]: value })
    }
  }

  return (
    <>
      {showTabs && (
        <div
          role="tablist"
          aria-label="Translations"
          data-test-id={`${id}-i18n-tabs`}
          className="flex flex-wrap gap-1 border-b border-[var(--ink-14)]"
        >
          {visibleLanguages
            .map((code) => LANGUAGE_META.find((m) => m.code === code))
            .filter((m): m is (typeof LANGUAGE_META)[number] => Boolean(m))
            .map((langMeta) => {
              const isActive = activeLang === langMeta.code
              const isDefault = langMeta.code === defaultLanguage
              return (
                <button
                  key={langMeta.code}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-test-id={`${id}-i18n-tab-${langMeta.code}`}
                  onClick={() => setActiveLang(langMeta.code)}
                  className={
                    'px-3 py-1.5 text-xs ' +
                    (isActive
                      ? 'border-b-2 border-[var(--ink)] font-medium text-[var(--ink)]'
                      : 'text-[var(--ink-55)] hover:text-[var(--ink)]')
                  }
                >
                  {langMeta.nativeName}
                  {isDefault && (
                    <span className="ml-1 font-[family-name:var(--mono)] text-[10px] uppercase tracking-[0.16em] opacity-70">
                      default
                    </span>
                  )}
                </button>
              )
            })}
        </div>
      )}
      {showName && (
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{nameLabel}</FieldLabel>
          <FieldInput
            id={`${id}-name`}
            data-test-id={`${id}-name-${activeLang}`}
            value={currentName}
            onChange={(e) => handleNameChange(e.target.value)}
            required={isDefaultTab && nameRequired}
            maxLength={nameMaxLength}
            placeholder={
              isDefaultTab ? undefined : `Translation for ${activeLang}`
            }
          />
        </Field>
      )}
      {showDescription && onDescriptionChange && (
        <Field>
          <FieldLabel htmlFor={`${id}-desc`}>{descriptionLabel}</FieldLabel>
          <FieldTextarea
            id={`${id}-desc`}
            data-test-id={`${id}-description-${activeLang}`}
            value={currentDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            rows={descriptionRows}
            maxLength={descriptionMaxLength}
          />
        </Field>
      )}
    </>
  )
}
