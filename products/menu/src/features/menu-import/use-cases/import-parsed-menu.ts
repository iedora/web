import 'server-only'
import type { ImportResult, MenuImportPort, ParsedCategory } from '../ports'

/**
 * Persists a list of parsed categories + items as a new menu.
 *
 * Creates: menu → (for each category) category → (for each item) item.
 * Positions are assigned as `index * 10` so there's room to insert later.
 *
 * Never throws — returns `{ error }` on any failure. The DB adapter may throw;
 * those bubble up as unhandled (Next.js logs them and surfaces a 500).
 */
export async function importParsedMenu(
  port: MenuImportPort,
  input: {
    restaurantId: string
    menuName: string
    categories: ParsedCategory[]
  },
): Promise<ImportResult> {
  const { restaurantId, menuName, categories } = input

  const menuId = await port.createMenu(restaurantId, menuName)

  for (const [catIdx, cat] of categories.entries()) {
    const categoryId = await port.insertCategory(
      menuId,
      restaurantId,
      cat.name,
      catIdx * 10,
    )

    for (const [itemIdx, it] of cat.items.entries()) {
      await port.insertItem(
        categoryId,
        restaurantId,
        {
          name: it.name,
          description: it.description,
          priceCents: it.priceCents,
          available: it.available,
          variants: it.variants,
        },
        itemIdx * 10,
      )
    }
  }

  return { ok: true, menuId }
}
