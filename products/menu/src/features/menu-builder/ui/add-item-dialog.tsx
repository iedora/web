'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import { useTranslations } from 'next-intl'
import { createItem } from '../actions'
import {
  VariantsEditor,
  cleanVariants,
  type EditableVariant,
} from './variants-editor'

/**
 * Add-item dialog — opens from the "+ Add item" CTA inside a section
 * card. The previous inline form sat at the bottom of each section,
 * which was visually noisy (one form per section) and forced the
 * operator to scroll to the bottom of a long section to add anything.
 *
 * Hot path is still `name + price` — those are the only required
 * fields. Variants (½ dose, alcohol-free, large, …) live in the same
 * shared `<VariantsEditor>` the edit dialog uses, so a bar or tasca
 * operator can seed the priced tiers at insert time instead of saving
 * a half-finished dish and re-opening it to edit. The Variants block
 * starts empty + collapsed under a "+ Add variant" affordance — no
 * room added to the dialog when not in use.
 *
 * `categoryName` is shown as the eyebrow so the operator can see which
 * section they're adding to (relevant on phones where the section
 * header is out of view).
 */
export function AddItemDialog({
  open,
  onOpenChange,
  slug,
  categoryId,
  categoryName,
  currency,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  slug: string
  categoryId: string
  categoryName: string
  currency: string
}) {
  const t = useTranslations('Builder')
  const router = useRouter()
  const [name, setName] = useState('')
  const [priceText, setPriceText] = useState('')
  const [variants, setVariants] = useState<EditableVariant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const nameInputId = `add-item-name-${categoryId}`

  // Reset on close runs in the close-side of the onOpenChange handler
  // rather than via useEffect — React's recommended pattern for "tear
  // down ephemeral state on a parent-driven event" since the reset is
  // a consequence of the toggle, not a synchronization.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('')
      setPriceText('')
      setVariants([])
      setError(null)
    }
    onOpenChange(next)
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('addItemNeedsName'))
      return
    }
    const priceCents = priceText.trim()
      ? Math.round(Number(priceText.replace(',', '.')) * 100)
      : 0
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError(t('addItemBadPrice'))
      return
    }
    const cleaned = cleanVariants(variants)
    if (!cleaned.ok) {
      setError(t('itemBadVariantPrice', { label: cleaned.label }))
      return
    }
    startTransition(async () => {
      const res = await createItem(slug, categoryId, {
        name: trimmed,
        priceCents,
        variants: cleaned.variants,
      })
      if (res && 'error' in res) {
        setError(res.error ?? t('addItemFailed'))
        return
      }
      router.refresh()
      // Stay open for batch-entry: clear the fields, refocus name.
      // Variants reset too — most batch entries don't share variants.
      setName('')
      setPriceText('')
      setVariants([])
      const el = document.getElementById(nameInputId) as HTMLInputElement | null
      el?.focus()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        eyebrow={categoryName}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('addItemTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          className="grid gap-4"
          data-test-id={`menu-add-item-form-${categoryId}`}
        >
          <Field>
            <FieldLabel htmlFor={nameInputId}>{t('addItemName')}</FieldLabel>
            <FieldInput
              id={nameInputId}
              autoFocus
              autoComplete="off"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-test-id={`menu-add-item-name-input-${categoryId}`}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`add-item-price-${categoryId}`}>
              {t('addItemPrice', { currency })}
            </FieldLabel>
            <FieldInput
              id={`add-item-price-${categoryId}`}
              inputMode="decimal"
              placeholder="0.00"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              data-test-id={`menu-add-item-price-input-${categoryId}`}
            />
          </Field>
          <VariantsEditor
            value={variants}
            onChange={setVariants}
            idPrefix={`menu-add-item-variant-${categoryId}`}
          />
          {error && (
            <p
              className="text-sm text-[var(--cinnabar)]"
              data-test-id={`menu-add-item-error-${categoryId}`}
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              data-test-id={`menu-add-item-close-${categoryId}`}
            >
              {t('done')}
            </Button>
            <Button
              type="submit"
              variant="solid"
              disabled={pending || name.trim().length === 0}
              data-test-id={`menu-add-item-submit-${categoryId}`}
            >
              {pending ? t('saving') : t('addItem')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
