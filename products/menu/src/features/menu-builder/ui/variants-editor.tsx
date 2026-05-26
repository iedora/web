'use client'

import { useTranslations } from 'next-intl'
import {
  Button,
  Field,
  FieldHint,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import type { LocalizedText } from '@/features/i18n'

/**
 * Shared variants editor for both the Add-item and Edit-item dialogs.
 *
 * "Variant" deliberately avoids "size" — a bar uses Alcohol-free /
 * Standard, a Portuguese tasca uses 1 dose / ½ dose, a pizzeria uses
 * Small / Medium / Large. The label is whatever the operator types.
 *
 * Layout per row:
 *   ┌────────────────────────┬────────┬───┐
 *   │ Label (compact input)  │ Price  │ × │
 *   └────────────────────────┴────────┴───┘
 *
 * On a narrow phone the label can read down to ~180px before truncating,
 * which fits every variant we've seen. The remove button is a
 * design-system ghost <Button> with a 40px+ tap target (not a 12px ×
 * character on naked text like the previous version).
 *
 * `labelI18n` carries non-default-language translations of the label.
 * THIS editor edits the source/default-language label only — translations
 * are edited in the Translations section of the dish dialog by the
 * sibling `<ItemVariantTranslations>` component, which mutates the same
 * `EditableVariant` rows via `onChange`. We round-trip `labelI18n`
 * here opaquely so add / remove / reorder don't drop translations.
 *
 * Stateless — the parent owns the array and a `(next) => void` updater.
 */

export type EditableVariant = {
  label: string
  /** Non-default-language translations, round-tripped opaque here. */
  labelI18n: LocalizedText | null
  /** Raw price string; empty mid-typing. Parsed on submit. */
  priceText: string
}

export function VariantsEditor({
  value,
  onChange,
  idPrefix,
}: {
  value: ReadonlyArray<EditableVariant>
  onChange: (next: EditableVariant[]) => void
  /** Used to namespace data-test-id attributes per row. */
  idPrefix: string
}) {
  const t = useTranslations('Builder')

  function add() {
    onChange([...value, { label: '', labelI18n: null, priceText: '' }])
  }
  function patch(idx: number, p: Partial<EditableVariant>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...p } : v)))
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <Field>
      <FieldLabel>{t('itemVariants')}</FieldLabel>

      {value.length === 0 ? (
        <FieldHint>{t('itemVariantsHint')}</FieldHint>
      ) : (
        <ul
          className="grid gap-2"
          data-test-id={`${idPrefix}-list`}
        >
          {value.map((v, vi) => (
            <li
              key={vi}
              className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2"
              data-test-id={`${idPrefix}-row-${vi}`}
            >
              <FieldInput
                compact
                value={v.label}
                onChange={(e) => patch(vi, { label: e.target.value })}
                placeholder={t('itemVariantLabel')}
                aria-label={t('itemVariantLabelAria')}
                data-test-id={`${idPrefix}-label-${vi}`}
                maxLength={60}
              />
              <FieldInput
                compact
                inputMode="decimal"
                value={v.priceText}
                onChange={(e) => patch(vi, { priceText: e.target.value })}
                placeholder="0.00"
                aria-label={t('itemVariantPriceAria', {
                  label: v.label || t('itemVariantLabelAria'),
                })}
                className="text-right"
                data-test-id={`${idPrefix}-price-${vi}`}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => remove(vi)}
                aria-label={t('itemVariantRemoveAria')}
                data-test-id={`${idPrefix}-remove-${vi}`}
                className="px-2"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="ghost"
        onClick={add}
        data-test-id={`${idPrefix}-add`}
        className="justify-self-start"
      >
        + {t('itemVariantAdd')}
      </Button>
    </Field>
  )
}

/**
 * Parses an `EditableVariant[]` into the persisted shape, dropping any
 * row whose label is blank. Returns `{ ok, variants }` on success or
 * `{ error, label }` pinning which row failed price parsing — the
 * dialog surfaces this verbatim via `itemBadVariantPrice`.
 */
export function cleanVariants(
  raw: ReadonlyArray<EditableVariant>,
):
  | {
      ok: true
      variants: {
        label: string
        labelI18n: LocalizedText | null
        priceCents: number
      }[]
    }
  | { ok: false; label: string } {
  const variants: {
    label: string
    labelI18n: LocalizedText | null
    priceCents: number
  }[] = []
  for (const v of raw) {
    const label = v.label.trim()
    if (label.length === 0) continue
    const n = Number(v.priceText.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return { ok: false, label }
    variants.push({
      label,
      labelI18n: v.labelI18n,
      priceCents: Math.round(n * 100),
    })
  }
  return { ok: true, variants }
}
