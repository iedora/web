'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { createMenu } from '@/features/menu-builder/actions'

export function CreateMenuDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const t = useTranslations('Restaurant')
  const tc = useTranslations('Common')

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const res = await createMenu(slug, formData)
      if (res && 'error' in res) {
        setError(res.error ?? 'Could not create menu')
        return
      }
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t('newMenu')}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newMenu')}</DialogTitle>
          <DialogDescription>
            Group categories under a name like &quot;Lunch&quot; or &quot;Dinner&quot;.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="menu-name">Name</Label>
            <Input id="menu-name" name="name" required maxLength={80} autoFocus />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? tc('saving') : tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
