import 'server-only'
import type {
  MenuImportPort,
  PatchOperation,
} from '../ports'

export type ApplyPatchResult =
  | {
      ok: true
      stats: {
        addedCategories: number
        removedCategories: number
        renamedCategories: number
        addedItems: number
        updatedItems: number
        removedItems: number
      }
    }
  | { error: string }

/**
 * Applies the AI's PATCH operations to an existing menu in this
 * restaurant. The adapter writes are NOT inside a single transaction
 * today (matches the rest of menu-import — see drizzle.ts header);
 * a partial failure leaves the menu in a partially-applied state that
 * the operator can recover from by re-running the patch.
 *
 * Order matters: new categories first (so add-item ops can resolve
 * `categoryName` against fresh ids), then category renames, then
 * item adds / updates / removes, then category removes (cascade
 * removes their items, so deleting first would orphan still-mentioned
 * item-ids).
 */
export async function applyMenuPatch(
  port: MenuImportPort,
  input: {
    restaurantId: string
    menuId: string
    operations: ReadonlyArray<PatchOperation>
  },
): Promise<ApplyPatchResult> {
  const { restaurantId, menuId, operations } = input
  const stats = {
    addedCategories: 0,
    removedCategories: 0,
    renamedCategories: 0,
    addedItems: 0,
    updatedItems: 0,
    removedItems: 0,
  }

  // 1. Create new categories + their inline items first so subsequent
  //    add-item ops referencing `categoryName` can be resolved.
  const newCategoryIds = new Map<string, string>() // name → id
  let nextCategoryPosition: number | null = null

  for (const op of operations) {
    if (op.kind !== 'add-category') continue
    if (nextCategoryPosition === null) {
      // Lazy: only ask the adapter the first time we need it.
      // Use a high number — operator can reorder later.
      nextCategoryPosition = 9_000
    }
    const categoryId = await port.insertCategory(
      menuId,
      restaurantId,
      op.name,
      nextCategoryPosition,
    )
    nextCategoryPosition += 10
    newCategoryIds.set(op.name, categoryId)
    stats.addedCategories += 1

    for (const [idx, it] of op.items.entries()) {
      await port.insertItem(
        categoryId,
        restaurantId,
        {
          name: it.name,
          description: it.description,
          priceCents: it.priceCents,
          available: true,
        },
        idx * 10,
      )
      stats.addedItems += 1
    }
  }

  // 2. Renames.
  for (const op of operations) {
    if (op.kind !== 'rename-category') continue
    await port.renameCategory(op.categoryId, restaurantId, op.name)
    stats.renamedCategories += 1
  }

  // 3. Item adds (resolve `categoryName` against the new-category map).
  for (const op of operations) {
    if (op.kind !== 'add-item') continue
    let categoryId = op.categoryId
    if (!categoryId && op.categoryName) {
      categoryId = newCategoryIds.get(op.categoryName) ?? null
    }
    if (!categoryId) {
      // No parent we can land on — skip (model error, don't fail the
      // whole patch).
      continue
    }
    const tail = await port.findMaxItemPosition(categoryId)
    await port.insertItem(
      categoryId,
      restaurantId,
      {
        name: op.name,
        description: op.description,
        priceCents: op.priceCents,
        available: true,
      },
      tail + 10,
    )
    stats.addedItems += 1
  }

  // 4. Item updates.
  for (const op of operations) {
    if (op.kind !== 'update-item') continue
    await port.updateItemFields(op.itemId, restaurantId, {
      name: op.name,
      description: op.description,
      priceCents: op.priceCents,
    })
    stats.updatedItems += 1
  }

  // 5. Item removes.
  for (const op of operations) {
    if (op.kind !== 'remove-item') continue
    await port.deleteItem(op.itemId, restaurantId)
    stats.removedItems += 1
  }

  // 6. Category removes — last (cascade kills any items still attached).
  for (const op of operations) {
    if (op.kind !== 'remove-category') continue
    await port.deleteCategory(op.categoryId, restaurantId)
    stats.removedCategories += 1
  }

  return { ok: true, stats }
}
