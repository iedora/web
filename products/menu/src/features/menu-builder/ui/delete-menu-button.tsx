'use client'

import { useState, useTransition } from 'react'
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
import { deleteMenu } from '../actions'

export function DeleteMenuButton({
  slug,
  menuId,
  menuName,
}: {
  slug: string
  menuId: string
  menuName: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={`Delete ${menuName}`}>
          ⋯
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {menuName}?</DialogTitle>
          <DialogDescription>
            This will remove the menu and all its categories and items. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          {/* destructive → accent (closest iedora visual for a danger action) */}
          <Button
            variant="accent"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteMenu(slug, menuId)
                setOpen(false)
              })
            }
          >
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
