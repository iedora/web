'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { ImageUpload } from '@/features/upload/ui/image-upload'
import { LocalizedFields } from '@/features/i18n/ui/localized-fields'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { deleteItem, updateItem } from '@/features/menu-builder/actions'
import type { BuilderItem } from './types'

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
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })

  const [open, setOpen] = useState(false)
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  // Maps of overrides keyed by language. Default language stays in `name`/
  // `description` above. The LocalizedFields component owns the active-tab UI.
  const [nameI18n, setNameI18n] = useState<LocalizedText>(() => item.nameI18n ?? {})
  const [descriptionI18n, setDescriptionI18n] = useState<LocalizedText>(
    () => item.descriptionI18n ?? {},
  )
  const [priceText, setPriceText] = useState((item.priceCents / 100).toFixed(2))
  const [available, setAvailable] = useState(item.available)
  // Local mirror for immediate dialog feedback after upload — server already
  // persists; router.refresh() syncs the row preview when the dialog closes.
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const priceCents = Math.round(Number(priceText.replace(',', '.')) * 100)
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError('Invalid price')
      return
    }
    startTransition(async () => {
      const res = await updateItem(slug, item.id, {
        name: name.trim(),
        description: description.trim(),
        priceCents,
        available,
        nameI18n,
        descriptionI18n,
      })
      if (res && 'error' in res) {
        setError(res.error ?? 'Could not save')
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex items-center gap-3 px-3 py-2"
    >
      <button
        aria-label="Drag item"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        ⋮⋮
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button className="flex flex-1 items-center justify-between gap-3 text-left">
              <div className="flex min-w-0 items-center gap-3">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    data-testid={`item-thumb-${item.id}`}
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className={item.available ? '' : 'text-muted-foreground line-through'}>
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-sm tabular-nums text-muted-foreground">
                {formatPrice(item.priceCents, item.currency)}
              </div>
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit item</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <LocalizedFields
              id="item"
              defaultLanguage={defaultLanguage}
              supportedLanguages={supportedLanguages}
              name={name}
              onNameChange={setName}
              description={description}
              onDescriptionChange={setDescription}
              nameI18n={nameI18n}
              onNameI18nChange={setNameI18n}
              descriptionI18n={descriptionI18n}
              onDescriptionI18nChange={setDescriptionI18n}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`price-${item.id}`}>Price ({item.currency})</Label>
                <Input
                  id={`price-${item.id}`}
                  inputMode="decimal"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-end gap-2">
                <input
                  id={`avail-${item.id}`}
                  type="checkbox"
                  checked={available}
                  onChange={(e) => setAvailable(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor={`avail-${item.id}`}>Available</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Photo</Label>
              <ImageUpload
                target={{ kind: 'item-photo', restaurantId, itemId: item.id }}
                currentUrl={imageUrl}
                label="Item photo"
                onChange={(url) => {
                  setImageUrl(url)
                  router.refresh()
                }}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="justify-between sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  startTransition(async () => {
                    await deleteItem(slug, item.id)
                    setOpen(false)
                    router.refresh()
                  })
                }
                disabled={pending}
              >
                Delete
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
