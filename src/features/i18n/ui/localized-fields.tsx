'use client'

import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { LANGUAGE_META } from '../registry'
import type { LanguageCode, LocalizedText } from '../types'

// Shared 1-or-2-field localized editor. Default-language values stay in
// `name`/`description` (text columns); other languages live in the maps.
// Pass `id` so callers can disambiguate testid namespaces when more than one
// instance lives on the same page.
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
  showDescription = true,
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
  showDescription?: boolean
  nameMaxLength?: number
  descriptionMaxLength?: number
  descriptionRows?: number
}) {
  const [activeLang, setActiveLang] = useState<LanguageCode>(defaultLanguage)
  const showTabs = supportedLanguages.length > 1
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
          data-testid={`${id}-i18n-tabs`}
          className="flex flex-wrap gap-1 border-b"
        >
          {supportedLanguages
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
                  data-testid={`${id}-i18n-tab-${langMeta.code}`}
                  onClick={() => setActiveLang(langMeta.code)}
                  className={
                    'px-3 py-1.5 text-xs ' +
                    (isActive
                      ? 'border-b-2 border-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {langMeta.nativeName}
                  {isDefault && (
                    <span className="ml-1 text-[10px] uppercase opacity-70">
                      default
                    </span>
                  )}
                </button>
              )
            })}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>{nameLabel}</Label>
        <Input
          id={`${id}-name`}
          data-testid={`${id}-name-${activeLang}`}
          value={currentName}
          onChange={(e) => handleNameChange(e.target.value)}
          required={isDefaultTab && nameRequired}
          maxLength={nameMaxLength}
          placeholder={
            isDefaultTab ? undefined : `Translation for ${activeLang}`
          }
        />
      </div>
      {showDescription && onDescriptionChange && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-desc`}>{descriptionLabel}</Label>
          <Textarea
            id={`${id}-desc`}
            data-testid={`${id}-description-${activeLang}`}
            value={currentDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            rows={descriptionRows}
            maxLength={descriptionMaxLength}
          />
        </div>
      )}
    </>
  )
}
