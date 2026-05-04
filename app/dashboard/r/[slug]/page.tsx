import Link from 'next/link'
import { eq, sql } from 'drizzle-orm'
import { requireRestaurantBySlug } from '@/lib/dal'
import { db } from '@/lib/db'
import { category, menu } from '@/lib/db/schema'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CreateMenuDialog } from './create-menu-dialog'
import { DeleteMenuButton } from './delete-menu-button'

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)

  const menus = await db
    .select({
      id: menu.id,
      name: menu.name,
      active: menu.active,
      categoryCount: sql<number>`(select count(*) from ${category} where ${category.menuId} = ${menu.id})`,
    })
    .from(menu)
    .where(eq(menu.restaurantId, r.id))
    .orderBy(menu.position)

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            ← Restaurants
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{r.name}</h1>
          <p className="text-sm text-muted-foreground">
            /r/{r.slug} · {r.published ? 'Published' : 'Draft'}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/r/${r.slug}`} target="_blank" rel="noreferrer" />}>
          View public menu
        </Button>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Menus</h2>
          <CreateMenuDialog slug={slug} />
        </div>

        {menus.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No menus yet</CardTitle>
              <CardDescription>Create one to start adding categories.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {menus.map((m) => (
              <div key={m.id} className="group relative">
                <Link href={`/dashboard/r/${slug}/m/${m.id}`} className="block">
                  <Card className="h-full transition-colors hover:bg-accent">
                    <CardHeader>
                      <CardTitle>{m.name}</CardTitle>
                      <CardDescription>
                        {m.categoryCount} {m.categoryCount === 1 ? 'category' : 'categories'}
                        {!m.active && ' · disabled'}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
                <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <DeleteMenuButton slug={slug} menuId={m.id} menuName={m.name} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
