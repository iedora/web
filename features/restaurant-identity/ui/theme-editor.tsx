'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Separator } from '@/shared/ui/separator'
import { ImageUpload } from '@/features/upload/ui/image-upload'
import { LocalizedFields } from '@/features/i18n/ui/localized-fields'
import { MenuRenderer } from '@/features/menu-publishing/rsc/menu-renderer'
import type { PublicMenu, PublicRestaurant } from '@/features/menu-publishing/rsc/types'
import type { LocalizedText } from '@/features/i18n'
import {
  DEFAULT_THEME,
  FONTS,
  HEX_PATTERN,
  LAYOUTS,
  type ResolvedTheme,
} from '@/features/menu-publishing/rsc/theme'
import { LANGUAGE_META, type LanguageCode } from '@/features/i18n'
import {
  updateIdentity,
  updateLanguageSettings,
  updateTheme,
} from '@/features/restaurant-identity/actions'

export type LanguageSettings = {
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
}

type Identity = Pick<
  PublicRestaurant,
  'name' | 'description' | 'logoUrl' | 'bannerUrl'
> & { descriptionI18n: LocalizedText }

export function ThemeEditor({
  slug,
  restaurant,
  restaurantDescriptionI18n,
  menus,
  initialTheme,
  initialLanguageSettings,
}: {
  slug: string
  restaurant: PublicRestaurant
  restaurantDescriptionI18n: LocalizedText
  menus: PublicMenu[]
  initialTheme: ResolvedTheme
  initialLanguageSettings: LanguageSettings
}) {
  const router = useRouter()
  const initialIdentity: Identity = {
    name: restaurant.name,
    description: restaurant.description,
    logoUrl: restaurant.logoUrl,
    bannerUrl: restaurant.bannerUrl,
    descriptionI18n: restaurantDescriptionI18n,
  }

  const [identity, setIdentity] = useState<Identity>(initialIdentity)
  const [theme, setTheme] = useState<ResolvedTheme>(initialTheme)

  const previewRestaurant: PublicRestaurant = { ...restaurant, ...identity }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-8">
        <IdentitySection
          slug={slug}
          restaurantId={restaurant.id}
          defaultLanguage={initialLanguageSettings.defaultLanguage}
          supportedLanguages={initialLanguageSettings.supportedLanguages}
          initial={initialIdentity}
          value={identity}
          onChange={setIdentity}
          onSaved={() => router.refresh()}
        />
        <Separator />
        <LanguagesSection
          slug={slug}
          initial={initialLanguageSettings}
          onSaved={() => router.refresh()}
        />
        <Separator />
        <ThemeSection
          slug={slug}
          initial={initialTheme}
          value={theme}
          onChange={setTheme}
          onSaved={() => router.refresh()}
        />
      </div>

      <div className="lg:sticky lg:top-6 lg:h-fit">
        <PreviewLabel />
        <div
          className="overflow-hidden rounded-lg border bg-background"
          data-testid="theme-preview"
          data-layout={theme.layout}
        >
          <MenuRenderer
            restaurant={previewRestaurant}
            menus={menus}
            theme={theme}
          />
        </div>
      </div>
    </div>
  )
}

function PreviewLabel() {
  const t = useTranslations('Settings')
  return (
    <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
      {t('livePreview')}
    </div>
  )
}

function LanguagesSection({
  slug,
  initial,
  onSaved,
}: {
  slug: string
  initial: LanguageSettings
  onSaved: () => void
}) {
  const [defaultLang, setDefaultLang] = useState<LanguageCode>(
    initial.defaultLanguage,
  )
  // Tracked as a Set so toggle is O(1) and order in the persisted array
  // follows the registry order (deterministic across renders).
  const [supported, setSupported] = useState<Set<LanguageCode>>(
    () => new Set(initial.supportedLanguages),
  )
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Settings.Languages')
  const tc = useTranslations('Common')

  function toggle(code: LanguageCode) {
    setSaved(false)
    setError(null)
    setSupported((prev) => {
      const next = new Set(prev)
      if (next.has(code)) {
        // Default cannot be removed — fallback chain breaks otherwise.
        if (code === defaultLang) return prev
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  function selectDefault(code: LanguageCode) {
    setSaved(false)
    setError(null)
    setDefaultLang(code)
    setSupported((prev) => new Set(prev).add(code))
  }

  const supportedList = LANGUAGE_META.filter((l) => supported.has(l.code)).map(
    (l) => l.code,
  )

  const dirty =
    defaultLang !== initial.defaultLanguage ||
    supportedList.length !== initial.supportedLanguages.length ||
    supportedList.some((c, i) => c !== initial.supportedLanguages[i])

  function onSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateLanguageSettings(slug, {
        defaultLanguage: defaultLang,
        supportedLanguages: supportedList,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      onSaved()
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <div>
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {LANGUAGE_META.map((lang) => {
            const isSupported = supported.has(lang.code)
            const isDefault = defaultLang === lang.code
            return (
              <div
                key={lang.code}
                data-testid={`lang-row-${lang.code}`}
                className={
                  'flex items-center justify-between gap-2 rounded-lg border p-3 ' +
                  (isSupported
                    ? 'border-primary bg-accent'
                    : 'border-border')
                }
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isSupported}
                    onChange={() => toggle(lang.code)}
                    disabled={isDefault}
                    data-testid={`lang-supported-${lang.code}`}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">{lang.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {lang.nativeName}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => selectDefault(lang.code)}
                  data-testid={`lang-default-${lang.code}`}
                  className={
                    'rounded px-2 py-0.5 text-xs ' +
                    (isDefault
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {isDefault ? t('default') : t('makeDefault')}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          disabled={!dirty || pending}
          data-testid="languages-save"
        >
          {pending ? tc('saving') : t('save')}
        </Button>
        {saved && !dirty && (
          <span className="text-sm text-muted-foreground">{t('saved')}</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  )
}

function IdentitySection({
  slug,
  restaurantId,
  defaultLanguage,
  supportedLanguages,
  initial,
  value,
  onChange,
  onSaved,
}: {
  slug: string
  restaurantId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  initial: Identity
  value: Identity
  onChange: (next: Identity) => void
  onSaved: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const t = useTranslations('Settings.Identity')
  const tc = useTranslations('Common')

  // Save button only tracks text fields. Logo/banner are persisted directly
  // by the ImageUpload component via features/upload/actions, so they don't
  // contribute to the dirty state here.
  const dirty =
    value.name !== initial.name ||
    (value.description ?? '') !== (initial.description ?? '') ||
    JSON.stringify(value.descriptionI18n) !==
      JSON.stringify(initial.descriptionI18n)

  const nameValid = value.name.trim().length > 0

  function patch<K extends keyof Identity>(key: K, v: Identity[K]) {
    onChange({ ...value, [key]: v })
    setSaved(false)
    setError(null)
  }

  function onSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateIdentity(slug, {
        name: value.name,
        description: value.description ?? '',
        descriptionI18n: value.descriptionI18n,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      onSaved()
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <div>
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="identity-name">{t('name')}</Label>
        <Input
          id="identity-name"
          data-testid="identity-name"
          value={value.name}
          onChange={(e) => patch('name', e.target.value)}
          maxLength={120}
          required
        />
      </div>

      {supportedLanguages.length > 1 ? (
        <LocalizedFields
          id="identity"
          defaultLanguage={defaultLanguage}
          supportedLanguages={supportedLanguages}
          // Restaurant name stays mono-language (proper noun) — only the
          // description is translatable here.
          name="" // unused
          onNameChange={() => {}}
          nameI18n={{}}
          onNameI18nChange={() => {}}
          description={value.description ?? ''}
          onDescriptionChange={(v) => patch('description', v)}
          descriptionI18n={value.descriptionI18n}
          onDescriptionI18nChange={(next) => patch('descriptionI18n', next)}
          nameLabel={t('description')}
          descriptionLabel={t('description')}
        />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="identity-description">{t('description')}</Label>
          <Textarea
            id="identity-description"
            data-testid="identity-description"
            value={value.description ?? ''}
            onChange={(e) => patch('description', e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('descriptionPlaceholder')}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>{t('logo')}</Label>
        <ImageUpload
          target={{ kind: 'restaurant-logo', restaurantId }}
          currentUrl={value.logoUrl}
          label={t('logo')}
          onChange={(url) => {
            patch('logoUrl', url)
            onSaved()
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('banner')}</Label>
        <ImageUpload
          target={{ kind: 'restaurant-banner', restaurantId }}
          currentUrl={value.bannerUrl}
          label={t('banner')}
          onChange={(url) => {
            patch('bannerUrl', url)
            onSaved()
          }}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          disabled={!dirty || !nameValid || pending}
          data-testid="identity-save"
        >
          {pending ? tc('saving') : t('save')}
        </Button>
        {saved && !dirty && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  )
}

function ThemeSection({
  slug,
  initial,
  value,
  onChange,
  onSaved,
}: {
  slug: string
  initial: ResolvedTheme
  value: ResolvedTheme
  onChange: (next: ResolvedTheme) => void
  onSaved: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const t = useTranslations('Settings.Theme')
  const tc = useTranslations('Common')

  const dirty =
    value.layout !== initial.layout ||
    value.font !== initial.font ||
    value.primaryColor !== initial.primaryColor ||
    value.secondaryColor !== initial.secondaryColor

  const primaryValid = HEX_PATTERN.test(value.primaryColor)
  const secondaryValid = HEX_PATTERN.test(value.secondaryColor)
  const canSave = dirty && primaryValid && secondaryValid && !pending

  function patch<K extends keyof ResolvedTheme>(key: K, v: ResolvedTheme[K]) {
    onChange({ ...value, [key]: v })
    setSaved(false)
    setError(null)
  }

  function onSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateTheme(slug, value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      onSaved()
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <div>
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('layout')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {LAYOUTS.map((l) => {
            const selected = value.layout === l.id
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => patch('layout', l.id)}
                aria-pressed={selected}
                data-testid={`layout-${l.id}`}
                className={
                  'rounded-lg border p-3 text-left transition-colors ' +
                  (selected
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/50')
                }
              >
                <div className="text-sm font-medium">{l.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {l.description}
                </div>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="theme-font">{t('font')}</Label>
        <select
          id="theme-font"
          data-testid="theme-font"
          value={value.font}
          onChange={(e) => patch('font', e.target.value as ResolvedTheme['font'])}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <ColorField
        id="theme-primary"
        label={t('primary')}
        hint={t('primaryHint')}
        value={value.primaryColor}
        valid={primaryValid}
        onChange={(v) => patch('primaryColor', v)}
      />
      <ColorField
        id="theme-secondary"
        label={t('secondary')}
        hint={t('secondaryHint')}
        value={value.secondaryColor}
        valid={secondaryValid}
        onChange={(v) => patch('secondaryColor', v)}
      />

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={!canSave} data-testid="theme-save">
          {pending ? tc('saving') : t('save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange(DEFAULT_THEME)
            setSaved(false)
            setError(null)
          }}
          disabled={pending}
        >
          {t('reset')}
        </Button>
        {saved && !dirty && (
          <span className="text-sm text-muted-foreground">{t('saved')}</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  )
}

function ColorField({
  id,
  label,
  hint,
  value,
  valid,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  valid: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
          aria-label={`${label} picker`}
        />
        <Input
          data-testid={`${id}-hex`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={'font-mono ' + (valid ? '' : 'border-destructive')}
        />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
