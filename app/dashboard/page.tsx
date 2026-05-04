import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { requireActiveOrganization } from '@/lib/dal'
import { db } from '@/lib/db'
import { restaurant } from '@/lib/db/schema'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default async function DashboardPage() {
  const { organizationId } = await requireActiveOrganization()

  const restaurants = await db
    .select()
    .from(restaurant)
    .where(eq(restaurant.organizationId, organizationId))
    .orderBy(restaurant.createdAt)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Restaurants</h1>
        <p className="text-sm text-muted-foreground">
          Pick a restaurant to manage its menus.
        </p>
      </div>

      {restaurants.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No restaurants yet</CardTitle>
            <CardDescription>
              Something went wrong during onboarding. Try{' '}
              <Link href="/onboarding" className="underline">
                creating one
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((r) => (
            <Link key={r.id} href={`/dashboard/r/${r.slug}`}>
              <Card className="transition-colors hover:bg-accent">
                <CardHeader>
                  <CardTitle>{r.name}</CardTitle>
                  <CardDescription>
                    /r/{r.slug} · {r.published ? 'Published' : 'Draft'}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
