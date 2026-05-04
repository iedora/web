'use client'

import { useEffect, useState, useTransition } from 'react'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCategory, reorderCategories } from './actions'
import { SortableCategory } from './sortable-category'
import type { BuilderCategory } from './types'

export function MenuBuilder({
  slug,
  menuId,
  initialCategories,
}: {
  slug: string
  menuId: string
  initialCategories: BuilderCategory[]
}) {
  const router = useRouter()
  const [categories, setCategories] = useState<BuilderCategory[]>(initialCategories)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [pending, startTransition] = useTransition()

  // After a server action calls revalidatePath + router.refresh, the page
  // re-renders with fresh `initialCategories`. Sync local state to it so
  // optimistic-only inserts (e.g. drag reorders) don't drift from the DB.
  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])

  // 8px activation distance prevents click-to-edit from triggering a drag.
  // KeyboardSensor with sortableKeyboardCoordinates makes the list accessible
  // (Tab to handle, Space to pick up, arrow keys to move, Space to drop) and
  // lets E2E tests drive reorder deterministically without flaky pointer math.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered) // optimistic
    startTransition(async () => {
      await reorderCategories(
        slug,
        menuId,
        reordered.map((c) => c.id),
      )
      router.refresh()
    })
  }

  function onAddCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newCategoryName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createCategory(slug, menuId, name)
      if (res && 'ok' in res) {
        setNewCategoryName('')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={categories.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {categories.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No categories yet. Add one below to get started.
              </p>
            ) : (
              categories.map((c) => (
                <SortableCategory key={c.id} slug={slug} category={c} />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      <form
        onSubmit={onAddCategory}
        className="flex items-center gap-2 rounded-lg border border-dashed p-3"
      >
        <Input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="New category name (e.g. Starters)"
          maxLength={80}
        />
        <Button type="submit" disabled={pending || newCategoryName.trim().length === 0}>
          Add category
        </Button>
      </form>
    </div>
  )
}
