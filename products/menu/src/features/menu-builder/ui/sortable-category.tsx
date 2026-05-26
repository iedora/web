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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FieldInput } from '@iedora/design-system'
import { useTranslations } from 'next-intl'
import type { LanguageCode } from '@/features/i18n'
import { reorderItems, updateCategoryName } from '../actions'
import { CategoryTranslateDialog } from './category-translate-dialog'
import { CategoryMenu } from './category-menu'
import { AddItemDialog } from './add-item-dialog'
import { SortableItem } from './sortable-item'
import type { BuilderCategory, BuilderItem } from './types'

/**
 * Renders one section card: title row + items list + "+ Add item" CTA.
 *
 * Big shifts vs the previous version:
 *   - Header is one row only: title (tap to rename inline) + small
 *     translate button (multi-lang only) + kebab. The destructive
 *     "Delete" lives behind the kebab so a misplaced tap doesn't nuke a
 *     section.
 *   - The inline add-item form is gone. "+ Add item" opens `AddItemDialog`
 *     which keeps the operator focused (one form, two fields).
 *   - Drag handles live on the LEFT and use a real SVG grip glyph.
 *     The whole row is the tap target — the operator drags by the grip,
 *     taps anywhere else to open the item editor.
 *
 * Reorder mode (Phase B candidate): right now drag is always live with
 * an 8px activation distance — safe for click-to-edit. A future "Reorder"
 * toggle behind the kebab can disable click-to-edit for the duration.
 */
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
  const t = useTranslations('Builder')
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id })

  const [items, setItems] = useState<BuilderItem[]>(category.items)
  const [prevItems, setPrevItems] = useState(category.items)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(category.name)
  const [prevName, setPrevName] = useState(category.name)
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Sync local state with the server-rendered prop after a mutation
  // triggers router.refresh() upstream. Render-phase update per React's
  // "reset state when a prop changes" recipe — better than useEffect
  // because the new state is visible on the same render.
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

  const dndId = useId()

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

  const currency = items[0]?.currency ?? 'EUR'

  return (
    <section
      ref={setNodeRef}
      id={`menu-section-${category.id}`}
      data-section-id={category.id}
      data-test-id={`menu-section-${category.id}`}
      className="menu-section-card"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <header className="menu-section-card__head">
        <button
          type="button"
          aria-label={t('dragSection', { name: category.name })}
          data-test-id={`menu-section-grip-${category.id}`}
          className="menu-builder-grip"
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>

        {editingName ? (
          <FieldInput
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
            className="h-9 flex-1"
            maxLength={80}
            data-test-id={`menu-section-name-input-${category.id}`}
          />
        ) : (
          <button
            type="button"
            className="menu-section-card__head-title"
            onClick={() => setEditingName(true)}
            data-test-id={`menu-section-title-${category.id}`}
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

        <CategoryMenu
          slug={slug}
          categoryId={category.id}
          categoryName={category.name}
          onRename={() => setEditingName(true)}
        />
      </header>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleItemDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="menu-section-card__items">
            {items.length === 0 ? (
              <p className="menu-section-card__empty">
                {t('emptySection')}
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

      <button
        type="button"
        className="menu-builder-add"
        onClick={() => setAddItemOpen(true)}
        disabled={pending}
        data-test-id={`menu-section-add-item-${category.id}`}
      >
        <span aria-hidden="true">＋</span>
        <span>{t('addItem')}</span>
      </button>

      <AddItemDialog
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        slug={slug}
        categoryId={category.id}
        categoryName={category.name}
        currency={currency}
      />
    </section>
  )
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      <circle cx="15" cy="6" r="1.5" fill="currentColor" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" />
      <circle cx="15" cy="18" r="1.5" fill="currentColor" />
    </svg>
  )
}
