'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import type { LanguageCode } from '@/features/i18n'
import {
  createItem,
  deleteCategory,
  reorderItems,
  updateCategoryName,
} from '@/features/menu-builder/actions'
import { CategoryTranslateDialog } from './category-translate-dialog'
import { SortableItem } from './sortable-item'
import type { BuilderCategory, BuilderItem } from './types'

export function SortableCategory({
  slug,
  restaurantId,
  defaultLanguage,
  supportedLanguages,
  category,
}: {
  slug: string
  restaurantId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  category: BuilderCategory
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  const router = useRouter()
  const [items, setItems] = useState<BuilderItem[]>(category.items)
  const [prevItems, setPrevItems] = useState(category.items)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(category.name)
  const [prevName, setPrevName] = useState(category.name)
  const [newItemName, setNewItemName] = useState('')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  // Sync local state with the server-rendered prop after a mutation triggers
  // router.refresh() upstream. Render-phase update over `useEffect` — React's
  // recommended pattern for "reset state when a prop changes" (see
  // https://react.dev/learn/you-might-not-need-an-effect).
  if (category.items !== prevItems) {
    setPrevItems(category.items)
    setItems(category.items)
  }
  if (category.name !== prevName) {
    setPrevName(category.name)
    setName(category.name)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered)
    startTransition(async () => {
      await reorderItems(
        slug,
        category.id,
        reordered.map((i) => i.id),
      )
      router.refresh()
    })
  }

  function commitName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === category.name) {
      setName(category.name)
      setEditingName(false)
      return
    }
    startTransition(async () => {
      const res = await updateCategoryName(slug, category.id, trimmed)
      if (res && 'error' in res) setName(category.name)
      setEditingName(false)
      router.refresh()
    })
  }

  function onAddItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = newItemName.trim()
    const priceCents = Math.round(Number(newItemPrice.replace(',', '.')) * 100)
    if (!trimmed || !Number.isFinite(priceCents) || priceCents < 0) return
    startTransition(async () => {
      const res = await createItem(slug, category.id, { name: trimmed, priceCents })
      if (res && 'ok' in res) {
        setNewItemName('')
        setNewItemPrice('')
        router.refresh()
      }
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
      className="rounded-lg border bg-card"
    >
      <div className="flex items-center gap-2 border-b p-3">
        <button
          aria-label="Drag category"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          ⋮⋮
        </button>
        {editingName ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setName(category.name)
                setEditingName(false)
              }
            }}
            className="h-8"
            maxLength={80}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex-1 text-left text-base font-medium hover:underline"
          >
            {category.name}
          </button>
        )}
        {supportedLanguages.length > 1 && (
          <CategoryTranslateDialog
            slug={slug}
            categoryId={category.id}
            defaultLanguage={defaultLanguage}
            supportedLanguages={supportedLanguages}
            initial={{
              name: category.name,
              description: category.description,
              nameI18n: category.nameI18n,
              descriptionI18n: category.descriptionI18n,
            }}
          />
        )}
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogTrigger
            render={
              <Button variant="ghost" size="sm" aria-label={`Delete ${category.name}`}>
                Delete
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {category.name}?</DialogTitle>
              <DialogDescription>
                Removes this category and all of its items.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteCategory(slug, category.id)
                    setConfirmDelete(false)
                    router.refresh()
                  })
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleItemDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="divide-y">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No items in this category yet.
              </p>
            ) : (
              items.map((it) => (
                <SortableItem
                  key={it.id}
                  slug={slug}
                  restaurantId={restaurantId}
                  defaultLanguage={defaultLanguage}
                  supportedLanguages={supportedLanguages}
                  item={it}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={onAddItem} className="flex items-center gap-2 border-t p-3">
        <Input
          placeholder="Item name"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          maxLength={120}
        />
        <Input
          placeholder="0.00"
          inputMode="decimal"
          value={newItemPrice}
          onChange={(e) => setNewItemPrice(e.target.value)}
          className="w-24"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={
            pending ||
            newItemName.trim().length === 0 ||
            newItemPrice.trim().length === 0
          }
        >
          Add item
        </Button>
      </form>
    </div>
  )
}
