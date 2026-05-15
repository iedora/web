# menu-builder slice

Drag-and-drop editing of menus, categories, items + translations.

## Public API (`@/features/menu-builder`)

- `loadBuilderData(restaurantId, menuId)` — typed page data for the builder RSC
- Types: `BuilderCategory`, `BuilderItem`

## Server actions (`@/features/menu-builder/actions`)

- `createCategory`, `updateCategoryName`, `updateCategoryTranslations`,
  `deleteCategory`, `reorderCategories`
- `updateMenu`
- `createItem`, `updateItem`, `deleteItem`, `reorderItems`

## UI (`@/features/menu-builder/ui/*`)

- `<MenuBuilder>` — main DnD orchestrator (client component)
- `<SortableCategory>`, `<SortableItem>`, `<CategoryTranslateDialog>`

## Port + adapter

`MenuWritePort` + `MenuReadPort` in `./ports.ts`. Production adapter in
`./adapters/drizzle.ts` — owns the single-transaction reorder + renumber
(AGENTS.md hard rule #7) and the tenant-scoped lookups that gate every
mutation (#1).
