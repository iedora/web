'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Field,
  FieldHint,
  FieldInput,
  FieldLabel,
  FieldTextarea,
  SectionHeader,
} from '@iedora/design-system'
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
  updateSlug,
  updateTheme,
} from '../actions'

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
    // Two-column at lg+: settings left (420px), preview sticky right.
    // On mobile we don't get two columns, so the preview goes FIRST
    // (order utilities) and lives inside a capped, scrollable frame —
    // otherwise a long menu would push every settings card below the
    // fold. Card order in the settings column reads identity → content
    // → look → URL; the slug is last because changing it breaks every
    // bookmark to the old URL and the operator rarely needs it.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="order-2 space-y-4 lg:order-none">
        <div className="settings-card" data-test-id="settings-card-identity">
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
        </div>
        <div className="settings-card" data-test-id="settings-card-languages">
          <LanguagesSection
            slug={slug}
            initial={initialLanguageSettings}
            onSaved={() => router.refresh()}
          />
        </div>
        <div className="settings-card" data-test-id="settings-card-theme">
          <ThemeSection
            slug={slug}
            initial={initialTheme}
            value={theme}
            onChange={setTheme}
            onSaved={() => router.refresh()}
          />
        </div>
        <div className="settings-card" data-test-id="settings-card-url">
          <SlugSection currentSlug={slug} />
        </div>
      </div>

      <div className="order-1 lg:order-none lg:sticky lg:top-6 lg:h-fit">
        <PreviewLabel />
        <div
          className="max-h-[60vh] overflow-auto border border-[var(--ink-14)] bg-[var(--paper)] lg:max-h-none lg:overflow-hidden"
          data-test-id="theme-preview"
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

/** Promote-on-switch result surfaced as a one-shot banner. Cleared on
 *  dismiss or on the next save. */
type SwitchOutcome = {
  rowsPromoted: number
  rowsNeedingAttention: number
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
  const [switchOutcome, setSwitchOutcome] = useState<SwitchOutcome | null>(
    null,
  )
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
    // A fresh save means any prior banner is now stale.
    setSwitchOutcome(null)
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
      // Only show the banner on an actual default-switch save — toggling
      // supportedLanguages alone doesn't rotate any rows.
      if (result.defaultChanged) {
        setSwitchOutcome({
          rowsPromoted: result.rowsPromoted,
          rowsNeedingAttention: result.rowsNeedingAttention,
        })
      }
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
      <SectionHeader title={t('title')} hint={t('subtitle')} />

      {/* Single-column list of language rows. Each row: design-system
          Checkbox on the left (serif label + native name), then either
          a "Default" badge or a ghost-button "Make default" on the
          right. Min-height 44px hits the touch-target floor. */}
      <ul className="space-y-2" data-test-id="lang-list">
        {LANGUAGE_META.map((lang) => {
          const isSupported = supported.has(lang.code)
          const isDefault = defaultLang === lang.code
          return (
            <li
              key={lang.code}
              data-test-id={`lang-row-${lang.code}`}
              className={
                'flex min-h-11 min-w-0 items-center gap-3 border px-3 py-2 ' +
                (isSupported
                  ? 'border-[var(--ink-40)] bg-[var(--paper-2)]'
                  : 'border-[var(--ink-14)] bg-[var(--paper)]')
              }
            >
              <Checkbox
                checked={isSupported}
                onChange={() => toggle(lang.code)}
                disabled={isDefault}
                data-test-id={`lang-supported-${lang.code}`}
                className="min-w-0 flex-1"
              >
                <span className="min-w-0">
                  <span className="truncate">{lang.name}</span>
                  <span className="ml-2 font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.16em] text-[var(--ink-55)]">
                    {lang.nativeName}
                  </span>
                </span>
              </Checkbox>
              {isDefault ? (
                <Badge
                  variant="ink"
                  data-test-id={`lang-default-${lang.code}`}
                >
                  {t('default')}
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => selectDefault(lang.code)}
                  data-test-id={`lang-default-${lang.code}`}
                  className="whitespace-nowrap"
                >
                  {t('makeDefault')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="solid"
          disabled={!dirty || pending}
          data-test-id="languages-save"
        >
          {pending ? tc('saving') : t('save')}
        </Button>
        {saved && !dirty && (
          <span className="text-sm text-[var(--ink-55)]">{t('saved')}</span>
        )}
        {error && (
          <span className="text-sm text-[var(--cinnabar)]">{error}</span>
        )}
      </div>

      {switchOutcome && (
        <DefaultSwitchedBanner
          outcome={switchOutcome}
          onDismiss={() => setSwitchOutcome(null)}
        />
      )}
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
      <SectionHeader title={t('title')} hint={t('subtitle')} />

      <Field>
        <FieldLabel htmlFor="identity-name">{t('name')}</FieldLabel>
        <FieldInput
          id="identity-name"
          data-test-id="identity-name"
          value={value.name}
          onChange={(e) => patch('name', e.target.value)}
          maxLength={120}
          required
        />
      </Field>

      {supportedLanguages.length > 1 ? (
        <LocalizedFields
          id="identity"
          defaultLanguage={defaultLanguage}
          supportedLanguages={supportedLanguages}
          // Restaurant name is a proper noun (mono-language) and lives
          // in the `Field` above; the tabbed editor only handles the
          // translatable description. `showName={false}` keeps the
          // language tabs but skips the redundant name row.
          name=""
          onNameChange={() => {}}
          nameI18n={{}}
          onNameI18nChange={() => {}}
          showName={false}
          description={value.description ?? ''}
          onDescriptionChange={(v) => patch('description', v)}
          descriptionI18n={value.descriptionI18n}
          onDescriptionI18nChange={(next) => patch('descriptionI18n', next)}
          descriptionLabel={t('description')}
        />
      ) : (
        <Field>
          <FieldLabel htmlFor="identity-description">{t('description')}</FieldLabel>
          <FieldTextarea
            id="identity-description"
            data-test-id="identity-description"
            value={value.description ?? ''}
            onChange={(e) => patch('description', e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('descriptionPlaceholder')}
          />
        </Field>
      )}

      <Field>
        <FieldLabel>{t('logo')}</FieldLabel>
        <ImageUpload
          target={{ kind: 'restaurant-logo', restaurantId }}
          currentUrl={value.logoUrl}
          label={t('logo')}
          onChange={(url) => {
            patch('logoUrl', url)
            onSaved()
          }}
        />
      </Field>

      <Field>
        <FieldLabel>{t('banner')}</FieldLabel>
        <ImageUpload
          target={{ kind: 'restaurant-banner', restaurantId }}
          currentUrl={value.bannerUrl}
          label={t('banner')}
          onChange={(url) => {
            patch('bannerUrl', url)
            onSaved()
          }}
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="solid"
          disabled={!dirty || !nameValid || pending}
          data-test-id="identity-save"
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

/**
 * Slug editor — separate from IdentitySection because the cost model is
 * different (changing the slug breaks bookmarks to the old URL + drops
 * the dashboard URL the user is on). Inline preview shows the resulting
 * `/r/<slug>` URL. On save, we route the dashboard URL to the new slug
 * so the operator stays on the same page they were editing.
 */
function SlugSection({ currentSlug }: { currentSlug: string }) {
  const router = useRouter()
  const t = useTranslations('Settings.Slug')
  const tc = useTranslations('Common')
  const [draft, setDraft] = useState(currentSlug)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const normalized = draft.trim().toLowerCase()
  const dirty = normalized !== currentSlug
  const looksValid =
    /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(normalized)

  function onSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateSlug(currentSlug, normalized)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSaved(true)
      // Route to the new dashboard URL — the requireRestaurantBySlug guard
      // on /dashboard/r/<currentSlug> would 404 now that the row's slug
      // moved. router.replace (not push) so the back button doesn't take
      // the user to a now-dead URL.
      router.replace(`/dashboard/r/${res.slug}`)
      router.refresh()
    })
  }

  return (
    <form
      className="space-y-4"
      data-test-id="slug-section"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && looksValid) onSave()
      }}
    >
      <SectionHeader title={t('title')} hint={t('subtitle')} />

      <Field>
        <FieldLabel htmlFor="slug-input">{t('label')}</FieldLabel>
        <div className="flex flex-wrap items-baseline gap-1">
          <span className="text-sm text-muted-foreground">menu.iedora.com/r/</span>
          <FieldInput
            id="slug-input"
            data-test-id="slug-input"
            className="min-w-0 flex-1 sm:min-w-[16ch]"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSaved(false)
              setError(null)
            }}
            maxLength={40}
          />
        </div>
        <FieldHint>{t('hint')}</FieldHint>
      </Field>

      {dirty && (
        <p className="text-xs text-[var(--cinnabar)]" role="status">
          {t('warning')}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="solid"
          disabled={!dirty || !looksValid || pending}
          data-test-id="slug-save"
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
      <SectionHeader title={t('title')} hint={t('subtitle')} />

      <fieldset className="space-y-2">
        <legend className="ds-field__label">{t('layout')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LAYOUTS.map((l) => {
            const selected = value.layout === l.id
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => patch('layout', l.id)}
                aria-pressed={selected}
                data-test-id={`layout-${l.id}`}
                className={
                  'min-h-[72px] border p-3 text-left transition-colors ' +
                  (selected
                    ? 'border-[var(--ink)] bg-[var(--paper-2)]'
                    : 'border-[var(--ink-14)] bg-[var(--paper)] hover:border-[var(--ink-40)]')
                }
              >
                <div className="font-[family-name:var(--serif)] text-base">
                  {l.name}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-55)]">
                  {l.description}
                </div>
              </button>
            )
          })}
        </div>
      </fieldset>

      <Field>
        <FieldLabel htmlFor="theme-font">{t('font')}</FieldLabel>
        <Combobox
          id="theme-font"
          data-test-id="theme-font"
          options={FONTS.map((f) => ({ value: f.id, label: f.name }))}
          value={value.font}
          onChange={(v) =>
            v && patch('font', v as ResolvedTheme['font'])
          }
          clearable={false}
          aria-label={t('font')}
        />
      </Field>

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

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="solid"
          disabled={!canSave}
          data-test-id="theme-save"
        >
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
          <span className="text-sm text-[var(--ink-55)]">{t('saved')}</span>
        )}
        {error && (
          <span className="text-sm text-[var(--cinnabar)]">{error}</span>
        )}
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
  // NOT wrapped in <Field>. The global `.ds-field input { width: 100% }`
  // rule stretches every input inside a Field — including
  // <input type="color"> — turning the 40×40 swatch into a full-width
  // colored bar. We replicate the field rhythm (label · row · hint
  // stacked with 6px gaps) by hand and keep the color picker outside
  // the cascade. Hex chip uses the `.ds-input--compact` chip from the
  // design system so it matches the Combobox / Field-compact family.
  return (
    <div className="grid w-full max-w-[380px] gap-1.5 font-[family-name:var(--mono)]">
      <FieldLabel htmlFor={`${id}-hex`}>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="color"
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-10 flex-shrink-0 cursor-pointer border border-[var(--ink-40)] bg-transparent p-0"
          aria-label={`${label} picker`}
          data-test-id={`${id}-picker`}
        />
        <input
          id={`${id}-hex`}
          data-test-id={`${id}-hex`}
          className={
            'ds-input ds-input--compact min-w-0 flex-1 font-[family-name:var(--mono)] uppercase ' +
            (valid ? '' : 'ds-input--error')
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          maxLength={7}
        />
      </div>
      <FieldHint className={valid ? undefined : 'text-[var(--cinnabar)]'}>
        {hint}
      </FieldHint>
    </div>
  )
}

/**
 * One-shot banner shown after a save that actually flipped the default
 * language. Two visual states:
 *
 *   - Promotion happy-path (rowsNeedingAttention === 0): quiet ink
 *     border, short "X translations promoted" line.
 *   - Some rows couldn't promote: cinnabar border, the count + the
 *     instruction ("Open each one to retranslate").
 *
 * Dismiss via the Button; no auto-hide — operators are working in a
 * settings flow, the signal is too important to flash away.
 */
function DefaultSwitchedBanner({
  outcome,
  onDismiss,
}: {
  outcome: SwitchOutcome
  onDismiss: () => void
}) {
  const t = useTranslations('Settings.Languages')
  const needsAttention = outcome.rowsNeedingAttention > 0
  const borderClass = needsAttention
    ? 'border-[var(--cinnabar)]'
    : 'border-[var(--ink-40)]'

  return (
    <aside
      role="status"
      data-test-id="languages-switched-banner"
      data-needs-attention={needsAttention ? 'true' : 'false'}
      className={
        'mt-3 flex flex-col gap-2 border bg-[var(--paper-2)] p-3 ' +
        borderClass
      }
    >
      <div className="flex flex-col gap-1">
        <span className="font-[family-name:var(--serif)] text-sm font-medium text-[var(--ink)]">
          {needsAttention ? t('switchedAttentionTitle') : t('switchedTitle')}
        </span>
        {outcome.rowsPromoted > 0 && (
          <span className="text-xs text-[var(--ink-55)]">
            {t('switchedSummary', { count: outcome.rowsPromoted })}
          </span>
        )}
        {needsAttention && (
          <span className="text-xs text-[var(--cinnabar)]">
            {t('switchedAttention', { count: outcome.rowsNeedingAttention })}
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onDismiss}
          data-test-id="languages-switched-banner-dismiss"
        >
          {t('switchedDismiss')}
        </Button>
      </div>
    </aside>
  )
}
