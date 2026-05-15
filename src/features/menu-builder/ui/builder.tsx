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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { LanguageCode } from '@/features/i18n'
import { createCategory, reorderCategories } from '@/features/menu-builder/actions'
import { SortableCategory } from './sortable-category'
import type { BuilderCategory } from './types'

export function MenuBuilder({
  slug,
  menuId,
  restaurantId,
  defaultLanguage,
  supportedLanguages,
  initialCategories,
}: {
  slug: string
  menuId: string
  restaurantId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  initialCategories: BuilderCategory[]
}) {
  const router = useRouter()
  const [categories, setCategories] = useState<BuilderCategory[]>(initialCategories)
  const [prevInitial, setPrevInitial] = useState(initialCategories)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [pending, startTransition] = useTransition()

  // After a server action calls revalidateRestaurant + router.refresh, the
  // page re-renders with fresh `initialCategories`. Sync local state via a
  // render-phase update — React's recommended pattern over `useEffect` for
  // "reset state when a prop changes" (https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes).
  if (initialCategories !== prevInitial) {
    setPrevInitial(initialCategories)
    setCategories(initialCategories)
  }

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
                <SortableCategory
                  key={c.id}
                  slug={slug}
                  restaurantId={restaurantId}
                  defaultLanguage={defaultLanguage}
                  supportedLanguages={supportedLanguages}
                  category={c}
                />
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
