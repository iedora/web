'use client'

import { useState, useTransition, type ReactNode } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@iedora/design-system'

export type ConfirmDialogProps = {
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  variant?: 'secondary' | 'danger'
  onConfirm: () => Promise<void> | void
  children: ReactNode
}

/**
 * Minimal confirm dialog wired over the DS Dialog primitives. The trigger
 * is the slot child; click → open → confirm runs `onConfirm` then closes.
 * Pending state is reflected in the confirm button.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'secondary',
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm()
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogPortal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <DialogActions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant={variant === 'danger' ? 'danger' : 'primary'}
                onClick={handleConfirm}
                disabled={isPending}
                data-variant={variant}
              >
                {confirmLabel}
              </Button>
            </DialogActions>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
