import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireRestaurantBySlug } from '@/lib/dal'
import { db } from '@/lib/db'
import { category, item, menu } from '@/lib/db/schema'
import { MenuBuilder } from './builder'

export default async function MenuBuilderPage({
  params,
}: {
  params: Promise<{ slug: string; menuId: string }>
}) {
  const { slug, menuId } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)

  const menuRows = await db
    .select({ id: menu.id, name: menu.name, restaurantId: menu.restaurantId })
    .from(menu)
    .where(and(eq(menu.id, menuId), eq(menu.restaurantId, r.id)))
    .limit(1)
  if (menuRows.length === 0) notFound()
  const m = menuRows[0]

  const categories = await db
    .select()
    .from(category)
    .where(eq(category.menuId, menuId))
    .orderBy(asc(category.position))

  const items =
    categories.length === 0
      ? []
      : await db
          .select()
          .from(item)
          .where(
            inArray(
              item.categoryId,
              categories.map((c) => c.id),
            ),
          )
          .orderBy(asc(item.position))

  const itemsByCategory: Record<string, typeof items> = {}
  for (const c of categories) itemsByCategory[c.id] = []
  for (const it of items) itemsByCategory[it.categoryId]?.push(it)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/r/${slug}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {r.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{m.name}</h1>
      </div>

      <MenuBuilder
        slug={slug}
        menuId={m.id}
        initialCategories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          items: itemsByCategory[c.id] ?? [],
        }))}
      />
    </div>
  )
}
