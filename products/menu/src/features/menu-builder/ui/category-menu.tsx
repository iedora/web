'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@iedora/design-system'
import { useTranslations } from 'next-intl'
import { deleteCategory } from '../actions'

/**
 * Category actions sheet. The kebab on each section card opens this
 * dialog showing the destructive + secondary actions in a vertical list
 * — big tap targets, plain text labels, dangerous "Delete" set apart in
 * cinnabar AND behind a confirmation step. We deliberately don't use a
 * popover/menu primitive: a centered dialog is easier to hit on a phone
 * and reads the same on desktop.
 *
 * Translate and Reorder are passed in as render slots so this file
 * doesn't pull dependencies for them — the parent decides whether to
 * surface those rows (Translate only renders when supportedLanguages
 * > 1; Reorder only when items.length > 1).
 */
export function CategoryMenu({
  slug,
  categoryId,
  categoryName,
  onRename,
  onReorder,
  translateSlot,
}: {
  slug: string
  categoryId: string
  categoryName: string
  onRename: () => void
  onReorder?: () => void
  translateSlot?: React.ReactNode
}) {
  const t = useTranslations('Builder')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  function close() {
    setOpen(false)
    setConfirmDelete(false)
  }

  function doRename() {
    setOpen(false)
    // defer so the dialog can finish closing before focus moves
    requestAnimationFrame(onRename)
  }

  function doReorder() {
    setOpen(false)
    if (onReorder) requestAnimationFrame(onReorder)
  }

  function doDelete() {
    startTransition(async () => {
      await deleteCategory(slug, categoryId)
      close()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t('sectionActionsAria', { name: categoryName })}
          data-test-id={`menu-section-kebab-${categoryId}`}
          className="menu-section-card__kebab"
        >
          {/* Three vertical dots — heavier glyph reads better than `⋮` on
              mobile Safari. */}
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.7" fill="currentColor" />
            <circle cx="12" cy="12" r="1.7" fill="currentColor" />
            <circle cx="12" cy="19" r="1.7" fill="currentColor" />
          </svg>
        </button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} eyebrow={t('sectionActionsEyebrow')}>
        <DialogHeader>
          <DialogTitle>{categoryName}</DialogTitle>
        </DialogHeader>

        {confirmDelete ? (
          <>
            <DialogDescription>
              {t('deleteSectionConfirm', { name: categoryName })}
            </DialogDescription>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
                data-test-id={`menu-section-delete-cancel-${categoryId}`}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="accent"
                onClick={doDelete}
                disabled={pending}
                data-test-id={`menu-section-delete-confirm-${categoryId}`}
              >
                {pending ? t('deleting') : t('deleteSection')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="menu-action-list">
            <button
              type="button"
              className="menu-action-list__item"
              onClick={doRename}
              data-test-id={`menu-section-action-rename-${categoryId}`}
            >
              {t('renameSection')}
            </button>
            {translateSlot}
            {onReorder && (
              <button
                type="button"
                className="menu-action-list__item"
                onClick={doReorder}
                data-test-id={`menu-section-action-reorder-${categoryId}`}
              >
                {t('reorderItems')}
              </button>
            )}
            <button
              type="button"
              className="menu-action-list__item menu-action-list__item--danger"
              onClick={() => setConfirmDelete(true)}
              data-test-id={`menu-section-action-delete-${categoryId}`}
            >
              {t('deleteSection')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
