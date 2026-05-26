'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldInput,
  FieldLabel,
  FieldTextarea,
  SectionHeader,
} from '@iedora/design-system'
import { useTranslations } from 'next-intl'
import { ImageUpload } from '@/features/upload/ui/image-upload'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { deleteItem, updateItem } from '../actions'
import type { BuilderItem, BuilderVariant } from './types'
import {
  VariantsEditor,
  cleanVariants,
  type EditableVariant,
} from './variants-editor'
import { ItemTranslations } from './item-translations'

/**
 * Item row + edit dialog.
 *
 * Row design:
 *   - Whole row is one tap target → open the edit dialog. The previous
 *     version split the row into a grip area and a click area, which
 *     was unreliable on touch (mis-taps hit the grip).
 *   - Grip is on the LEFT, an SVG glyph not unicode, with `cursor: grab`
 *     and `min-width: 28px`. Drag activation is gated by an 8px move
 *     threshold so a tap can't be misread as a drag.
 *   - Price column: hides "€0.00" — shows the localised "no price" hint
 *     in ink-40 italics instead, so the row doesn't lie about prices
 *     the operator hasn't entered.
 *   - Description shows truncated under the name on one line; variants
 *     pill-row below for items with 2+ doses.
 *
 * Edit dialog design:
 *   - Two stacked groups. The top "basics" (name, price, photo,
 *     available) is what the operator touches 90% of the time. The
 *     "More options" disclosure expands description, variants,
 *     translations, and delete.
 *   - On desktop both can be open simultaneously; on mobile the
 *     disclosure keeps the form short enough to fit the viewport without
 *     internal scrolling.
 */

function variantsToEditable(
  variants: ReadonlyArray<BuilderVariant>,
): EditableVariant[] {
  return variants.map((v) => ({
    label: v.label,
    labelI18n: v.labelI18n,
    priceText: v.priceCents > 0 ? (v.priceCents / 100).toFixed(2) : '',
  }))
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

export function SortableItem({
  slug,
  restaurantId,
  defaultLanguage,
  supportedLanguages,
  item,
}: {
  slug: string
  restaurantId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  item: BuilderItem
}) {
  const t = useTranslations('Builder')
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const [open, setOpen] = useState(false)
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [nameI18n, setNameI18n] = useState<LocalizedText>(
    () => item.nameI18n ?? {},
  )
  const [descriptionI18n, setDescriptionI18n] = useState<LocalizedText>(
    () => item.descriptionI18n ?? {},
  )
  const [priceText, setPriceText] = useState(
    item.priceCents > 0 ? (item.priceCents / 100).toFixed(2) : '',
  )
  const [available, setAvailable] = useState(item.available)
  const [variants, setVariants] = useState<EditableVariant[]>(() =>
    variantsToEditable(item.variants),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset local state when reopening so it tracks server truth.
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setConfirmDelete(false)
      setError(null)
    } else {
      setName(item.name)
      setDescription(item.description ?? '')
      setNameI18n(item.nameI18n ?? {})
      setDescriptionI18n(item.descriptionI18n ?? {})
      setPriceText(item.priceCents > 0 ? (item.priceCents / 100).toFixed(2) : '')
      setAvailable(item.available)
      setVariants(variantsToEditable(item.variants))
      setImageUrl(item.imageUrl)
    }
  }

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('itemNeedsName'))
      return
    }
    const priceCents = priceText.trim()
      ? Math.round(Number(priceText.replace(',', '.')) * 100)
      : 0
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError(t('itemBadPrice'))
      return
    }

    const cleaned = cleanVariants(variants)
    if (!cleaned.ok) {
      setError(t('itemBadVariantPrice', { label: cleaned.label }))
      return
    }

    startTransition(async () => {
      const res = await updateItem(slug, item.id, {
        name: trimmed,
        description: description.trim(),
        priceCents,
        available,
        nameI18n,
        descriptionI18n,
        variants: cleaned.variants,
      })
      if (res && 'error' in res) {
        setError(res.error ?? t('itemSaveFailed'))
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  function doDelete() {
    startTransition(async () => {
      await deleteItem(slug, item.id)
      setOpen(false)
      router.refresh()
    })
  }

  const showPrice = item.priceCents > 0
  const formattedPrice = showPrice ? formatPrice(item.priceCents, item.currency) : null
  const hasMultiLanguage = supportedLanguages.length > 1

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        className="menu-item-row"
        onClick={() => onOpenChange(true)}
        data-test-id={`menu-item-row-${item.id}`}
        data-unavailable={item.available ? 'false' : 'true'}
      >
        <span
          className="menu-builder-grip"
          aria-label={t('dragItem', { name: item.name })}
          data-test-id={`menu-item-grip-${item.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </span>
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            data-testid={`item-thumb-${item.id}`}
            className="menu-item-row__thumb"
          />
        )}
        <span className="menu-item-row__body">
          <span className="menu-item-row__name">{item.name}</span>
          {item.description && (
            <span className="menu-item-row__desc">{item.description}</span>
          )}
          {item.variants.length > 0 && (
            <span
              className="menu-item-row__variants"
              data-test-id={`item-variants-${item.id}`}
            >
              {item.variants.map((v, vi) => (
                <span
                  key={`${v.label}-${vi}`}
                  className="menu-item-row__variant-pill"
                >
                  <span>{v.label}</span>
                  <span aria-hidden="true">·</span>
                  <span className="num">
                    {formatPrice(v.priceCents, item.currency)}
                  </span>
                </span>
              ))}
            </span>
          )}
        </span>
        <span
          className={
            showPrice
              ? 'menu-item-row__price'
              : 'menu-item-row__price menu-item-row__price--zero'
          }
        >
          {formattedPrice ?? t('noPrice')}
        </span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          eyebrow={t('itemEditEyebrow')}
        >
          <DialogHeader>
            <DialogTitle>{t('editItem')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={onSave}
            className="grid gap-6"
            data-test-id={`menu-item-edit-form-${item.id}`}
          >
            {/* ─── Part 1 · Dish ─────────────────────────────────────
                The basics every dish needs: name + description in the
                source/default language, price, availability, photo.
                Description always lives here (source) — translations
                of it live in Part 3 alongside the name translations. */}
            <section className="grid gap-4" data-test-id={`menu-item-part-dish-${item.id}`}>
              <SectionHeader title={t('partDishTitle')} hint={t('partDishHint')} />
              <Field>
                <FieldLabel htmlFor={`item-name-${item.id}`}>
                  {t('itemName')}
                </FieldLabel>
                <FieldInput
                  id={`item-name-${item.id}`}
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  data-test-id={`menu-item-name-input-${item.id}`}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`item-desc-${item.id}`}>
                  {t('itemDescription')}
                </FieldLabel>
                <FieldTextarea
                  id={`item-desc-${item.id}`}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-test-id={`menu-item-desc-input-${item.id}`}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`item-price-${item.id}`}>
                    {t('itemPrice', { currency: item.currency })}
                  </FieldLabel>
                  <FieldInput
                    id={`item-price-${item.id}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    data-test-id={`menu-item-price-input-${item.id}`}
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <Checkbox
                    checked={available}
                    onChange={(e) =>
                      setAvailable((e.target as HTMLInputElement).checked)
                    }
                    data-test-id={`menu-item-available-${item.id}`}
                  >
                    {t('itemAvailable')}
                  </Checkbox>
                </div>
              </div>
              <Field>
                <FieldLabel>{t('itemPhoto')}</FieldLabel>
                <ImageUpload
                  target={{ kind: 'item-photo', restaurantId, itemId: item.id }}
                  currentUrl={imageUrl}
                  label={t('itemPhoto')}
                  onChange={(url) => {
                    setImageUrl(url)
                    router.refresh()
                  }}
                />
              </Field>
            </section>

            {/* ─── Part 2 · Variants ────────────────────────────────
                Operator-defined priced tiers — ½ dose, alcohol-free,
                large… labels are in the default language (Part 3 will
                translate them once variant-i18n lands). */}
            <section data-test-id={`menu-item-part-variants-${item.id}`}>
              <SectionHeader
                title={t('partVariantsTitle')}
                hint={t('partVariantsHint')}
              />
              <div className="mt-3">
                <VariantsEditor
                  value={variants}
                  onChange={setVariants}
                  idPrefix={`item-variant-${item.id}`}
                />
              </div>
            </section>

            {/* ─── Part 3 · Translations ─────────────────────────────
                Only rendered for multi-language restaurants. The
                default language is intentionally hidden — its values
                are the source-of-truth edited in Part 1 (name +
                description) and Part 2 (variant labels). Operators see
                the source value above each translation field so they
                don't have to flip tabs to know what they're translating. */}
            {hasMultiLanguage && (
              <section
                className="grid gap-4"
                data-test-id={`menu-item-part-translations-${item.id}`}
              >
                <SectionHeader
                  title={t('partTranslationsTitle')}
                  hint={t('partTranslationsHint')}
                />
                <ItemTranslations
                  itemId={item.id}
                  defaultLanguage={defaultLanguage}
                  supportedLanguages={supportedLanguages}
                  name={name}
                  description={description}
                  variants={variants}
                  nameI18n={nameI18n}
                  descriptionI18n={descriptionI18n}
                  onNameI18nChange={setNameI18n}
                  onDescriptionI18nChange={setDescriptionI18n}
                  onVariantsChange={setVariants}
                />
              </section>
            )}

            {/* ─── Part 4 · Danger zone (delete) ────────────────────
                Quiet by default, cinnabar on confirm. Sits alone at
                the bottom so an accidental tap can't reach it during
                normal editing. */}
            <section
              className="border-t border-[var(--ink-14)] pt-4"
              data-test-id={`menu-item-part-danger-${item.id}`}
            >
              {confirmDelete ? (
                <div className="flex flex-col gap-3 border border-[var(--cinnabar)] p-3">
                  <p className="text-sm">
                    {t('itemDeleteConfirm', { name: item.name })}
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmDelete(false)}
                      disabled={pending}
                      data-test-id={`menu-item-delete-cancel-${item.id}`}
                    >
                      {t('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="accent"
                      onClick={doDelete}
                      disabled={pending}
                      data-test-id={`menu-item-delete-confirm-${item.id}`}
                    >
                      {pending ? t('deleting') : t('deleteItem')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  className="justify-self-start text-[var(--cinnabar)]"
                  data-test-id={`menu-item-delete-${item.id}`}
                >
                  {t('deleteItem')}
                </Button>
              )}
            </section>

            {error && (
              <p
                className="text-sm text-[var(--cinnabar)]"
                data-test-id={`menu-item-error-${item.id}`}
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                data-test-id={`menu-item-cancel-${item.id}`}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                variant="solid"
                disabled={pending}
                data-test-id={`menu-item-save-${item.id}`}
              >
                {pending ? t('saving') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      <circle cx="15" cy="6" r="1.5" fill="currentColor" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" />
      <circle cx="15" cy="18" r="1.5" fill="currentColor" />
    </svg>
  )
}
