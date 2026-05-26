'use client'

import { useId, useState, useTransition } from 'react'
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
import { useTranslations } from 'next-intl'
import type { LanguageCode } from '@/features/i18n'
import { reorderCategories } from '../actions'
import { SortableCategory } from './sortable-category'
import { SectionChips } from './section-chips'
import { AddSectionDialog } from './add-section-dialog'
import type { BuilderCategory } from './types'

/**
 * Restaurant menu editor — top-level shell.
 *
 * The redesign organises the surface as a real app:
 *
 *   1. Sticky horizontal chip nav      — tap to jump to any section.
 *   2. Stacked section cards            — each card has its own kebab
 *                                         (Rename / Translate / Delete)
 *                                         and a "+ Add item" CTA at the
 *                                         bottom.
 *   3. Quiet dotted "+ Add section"     — bottom of the page.
 *
 * The chip nav doubles as a visual table of contents — operators with
 * 25–40 dishes across 4–6 sections can scan the whole menu without
 * scrolling. IntersectionObserver in `SectionChips` keeps the chip
 * matching whichever section is currently in view.
 *
 * Every interactive element here is at least 44px tall. No inline
 * forms sit at the bottom of every section like before; "+ Add item"
 * opens a focused dialog so the operator's hot path is two taps
 * (tap +, type name, save → repeat).
 */
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
  const t = useTranslations('Builder')
  const router = useRouter()
  const [categories, setCategories] = useState<BuilderCategory[]>(initialCategories)
  const [prevInitial, setPrevInitial] = useState(initialCategories)
  const [addSectionOpen, setAddSectionOpen] = useState(false)
  const [, startTransition] = useTransition()

  // Sync local state with the server-rendered prop after mutations —
  // render-phase update is the React-recommended pattern for "reset on
  // prop change". See https://react.dev/learn/you-might-not-need-an-effect.
  if (initialCategories !== prevInitial) {
    setPrevInitial(initialCategories)
    setCategories(initialCategories)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const dndId = useId()

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

  return (
    <div className="space-y-4">
      {categories.length > 0 && (
        <SectionChips
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          addLabel={t('addSection')}
          onAddSection={() => setAddSectionOpen(true)}
        />
      )}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={categories.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {categories.length === 0 ? (
              <div className="border border-dashed border-[var(--ink-24)] p-8 text-center">
                <p
                  className="text-base text-[var(--ink-70)] mb-4"
                  data-test-id="menu-builder-empty"
                >
                  {t('emptyMenu')}
                </p>
                <button
                  type="button"
                  className="menu-builder-add-section"
                  onClick={() => setAddSectionOpen(true)}
                  data-test-id="menu-builder-add-section-empty"
                >
                  <span aria-hidden="true">＋</span>
                  <span>{t('addFirstSection')}</span>
                </button>
              </div>
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

      {categories.length > 0 && (
        <button
          type="button"
          className="menu-builder-add-section"
          onClick={() => setAddSectionOpen(true)}
          data-test-id="menu-builder-add-section"
        >
          <span aria-hidden="true">＋</span>
          <span>{t('addSection')}</span>
        </button>
      )}

      <AddSectionDialog
        open={addSectionOpen}
        onOpenChange={setAddSectionOpen}
        slug={slug}
        menuId={menuId}
      />
    </div>
  )
}
