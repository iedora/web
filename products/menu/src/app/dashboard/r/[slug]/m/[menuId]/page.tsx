import { notFound } from 'next/navigation'
import { requireRestaurantBySlug } from '@/features/auth'
import { loadBuilderData } from '@/features/menu-builder'
import { MenuBuilder } from '@/features/menu-builder/ui/builder'
import { DashboardPage } from '@/shared/ui/dashboard-page'

export default async function MenuBuilderPage({
  params,
}: {
  params: Promise<{ slug: string; menuId: string }>
}) {
  const { slug, menuId } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const data = await loadBuilderData(r.id, menuId)
  if (!data) notFound()

  return (
    <DashboardPage
      title={data.menu.name}
      data-test-id="menu-builder"
      crumbs={[
        { label: r.name, href: `/dashboard/r/${slug}`, testId: 'restaurant' },
      ]}
    >
      <MenuBuilder
        slug={slug}
        menuId={data.menu.id}
        restaurantId={r.id}
        defaultLanguage={data.defaultLanguage}
        supportedLanguages={data.supportedLanguages}
        initialCategories={data.categories}
      />
    </DashboardPage>
  )
}
