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
import { createCategory } from '../actions'

/**
 * Add-section dialog. Single field — section name. Same shape as
 * AddItemDialog so the operator's mental model is "tap +, type a name,
 * save". Keeps focused after Save so they can chain multiple sections
 * (Starters → Mains → Desserts → Drinks in one sitting).
 */
export function AddSectionDialog({
  open,
  onOpenChange,
  slug,
  menuId,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  slug: string
  menuId: string
}) {
  const t = useTranslations('Builder')
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const nameInputId = 'add-section-name'

  // Reset on close inside the close-side of onOpenChange — see the
  // matching note in add-item-dialog.tsx.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('')
      setError(null)
    }
    onOpenChange(next)
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('addSectionNeedsName'))
      return
    }
    startTransition(async () => {
      const res = await createCategory(slug, menuId, trimmed)
      if (res && 'error' in res) {
        setError(res.error ?? t('addSectionFailed'))
        return
      }
      router.refresh()
      setName('')
      const el = document.getElementById(nameInputId) as HTMLInputElement | null
      el?.focus()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('addSectionTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          className="grid gap-4"
          data-test-id="menu-add-section-form"
        >
          <Field>
            <FieldLabel htmlFor={nameInputId}>
              {t('addSectionName')}
            </FieldLabel>
            <FieldInput
              id={nameInputId}
              autoFocus
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('addSectionPlaceholder')}
              data-test-id="menu-add-section-name-input"
            />
          </Field>
          {error && (
            <p
              className="text-sm text-[var(--cinnabar)]"
              data-test-id="menu-add-section-error"
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
              data-test-id="menu-add-section-close"
            >
              {t('done')}
            </Button>
            <Button
              type="submit"
              variant="solid"
              disabled={pending || name.trim().length === 0}
              data-test-id="menu-add-section-submit"
            >
              {pending ? t('saving') : t('addSection')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
