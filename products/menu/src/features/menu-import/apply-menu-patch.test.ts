import { describe, expect, it, vi } from 'vitest'
import type { MenuImportPort } from './ports'
import { applyMenuPatch } from './use-cases/apply-menu-patch'

vi.mock('server-only', () => ({}))

type CallLog = Array<
  | { kind: 'insertCategory'; menuId: string; name: string; position: number }
  | {
      kind: 'insertItem'
      categoryId: string
      name: string
      priceCents: number
      position: number
    }
  | { kind: 'updateItem'; itemId: string; patch: Record<string, unknown> }
  | { kind: 'deleteItem'; itemId: string }
  | { kind: 'deleteCategory'; categoryId: string }
  | { kind: 'renameCategory'; categoryId: string; name: string }
>

function makePort(): { port: MenuImportPort; calls: CallLog } {
  const calls: CallLog = []
  let nextCategorySeq = 0
  const port: MenuImportPort = {
    async createMenu() {
      throw new Error('not used in patch flow')
    },
    async insertCategory(menuId, _restaurantId, name, position) {
      const id = `cat-${(nextCategorySeq += 1)}`
      calls.push({ kind: 'insertCategory', menuId, name, position })
      return id
    },
    async insertItem(categoryId, _restaurantId, fields, position) {
      calls.push({
        kind: 'insertItem',
        categoryId,
        name: fields.name,
        priceCents: fields.priceCents,
        position,
      })
    },
    async setRestaurantDefaultLanguage() {
      return true
    },
    async findCategoryByMenuAndName() {
      return null
    },
    async renameCategory(categoryId, _restaurantId, name) {
      calls.push({ kind: 'renameCategory', categoryId, name })
    },
    async deleteCategory(categoryId) {
      calls.push({ kind: 'deleteCategory', categoryId })
    },
    async updateItemFields(itemId, _restaurantId, patch) {
      calls.push({ kind: 'updateItem', itemId, patch: { ...patch } })
    },
    async deleteItem(itemId) {
      calls.push({ kind: 'deleteItem', itemId })
    },
    async findMaxItemPosition() {
      return 30
    },
  }
  return { port, calls }
}

describe('applyMenuPatch', () => {
  it('is a no-op when operations is empty', async () => {
    const { port, calls } = makePort()
    const res = await applyMenuPatch(port, {
      restaurantId: 'r-1',
      menuId: 'm-1',
      operations: [],
    })
    expect(res).toEqual({
      ok: true,
      stats: {
        addedCategories: 0,
        removedCategories: 0,
        renamedCategories: 0,
        addedItems: 0,
        updatedItems: 0,
        removedItems: 0,
      },
    })
    expect(calls).toEqual([])
  })

  it('orders ops correctly: add-category first, removes last', async () => {
    const { port, calls } = makePort()
    await applyMenuPatch(port, {
      restaurantId: 'r-1',
      menuId: 'm-1',
      operations: [
        { kind: 'remove-category', categoryId: 'cat-old' },
        { kind: 'remove-item', itemId: 'it-old' },
        {
          kind: 'add-category',
          name: 'Sobremesas',
          items: [{ name: 'Arroz doce', priceCents: 400 }],
        },
        {
          kind: 'add-item',
          categoryId: 'cat-existing',
          name: 'Café',
          priceCents: 100,
        },
        { kind: 'update-item', itemId: 'it-x', priceCents: 1450 },
      ],
    })

    const kinds = calls.map((c) => c.kind)
    // add-category fires first so its `add-item` siblings can resolve
    // via the new id; deletes are last so cascades don't orphan
    // still-referenced ids.
    expect(kinds[0]).toBe('insertCategory') // add-category
    expect(kinds[1]).toBe('insertItem') // its inline item (Arroz doce)
    expect(kinds[kinds.length - 1]).toBe('deleteCategory')
    // remove-item should sit before remove-category but after updates.
    const updateAt = kinds.indexOf('updateItem')
    const deleteItemAt = kinds.indexOf('deleteItem')
    const deleteCatAt = kinds.indexOf('deleteCategory')
    expect(updateAt).toBeLessThan(deleteItemAt)
    expect(deleteItemAt).toBeLessThan(deleteCatAt)
  })

  it('resolves add-item with categoryName against a fresh add-category', async () => {
    const { port, calls } = makePort()
    await applyMenuPatch(port, {
      restaurantId: 'r-1',
      menuId: 'm-1',
      operations: [
        { kind: 'add-category', name: 'Bebidas', items: [] },
        {
          kind: 'add-item',
          categoryId: null,
          categoryName: 'Bebidas',
          name: 'Vinho da casa',
          priceCents: 500,
        },
      ],
    })

    const insertedCategory = calls.find((c) => c.kind === 'insertCategory')!
    expect(insertedCategory.name).toBe('Bebidas')
    // Item should land under the newly-minted category id, not a stale
    // string.
    const insertedItem = calls.find(
      (c) => c.kind === 'insertItem' && c.name === 'Vinho da casa',
    )!
    expect(insertedItem.kind).toBe('insertItem')
    if (insertedItem.kind === 'insertItem') {
      expect(insertedItem.categoryId).toBe('cat-1')
    }
  })

  it('skips an add-item whose parent never materialises (model error tolerance)', async () => {
    const { port, calls } = makePort()
    await applyMenuPatch(port, {
      restaurantId: 'r-1',
      menuId: 'm-1',
      operations: [
        {
          kind: 'add-item',
          categoryId: null,
          categoryName: 'Phantom section',
          name: 'Ghost',
          priceCents: 0,
        },
      ],
    })
    expect(calls.some((c) => c.kind === 'insertItem')).toBe(false)
  })

  it('only forwards the changed fields on update-item (price-only edit)', async () => {
    const { port, calls } = makePort()
    await applyMenuPatch(port, {
      restaurantId: 'r-1',
      menuId: 'm-1',
      operations: [{ kind: 'update-item', itemId: 'it-x', priceCents: 1450 }],
    })
    const update = calls.find((c) => c.kind === 'updateItem')!
    if (update.kind !== 'updateItem') throw new Error('unreachable')
    expect(update.patch).toEqual({ priceCents: 1450 })
  })
})
