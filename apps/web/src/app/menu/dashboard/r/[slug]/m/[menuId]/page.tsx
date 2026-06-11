import { notFound } from 'next/navigation'
import { requireRestaurantBySlug } from '@iedora/product-menu/features/auth'
import { loadBuilderData } from '@iedora/product-menu/features/menu-builder'
import { MenuBuilder } from '@iedora/product-menu/features/menu-builder/ui/builder'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import type { LanguageCode } from '@iedora/product-menu/features/i18n'

export default async function MenuBuilderPage({
  params,
}: {
  params: Promise<{ slug: string; menuId: string }>
}) {
  const { slug, menuId } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const data = await loadBuilderData(slug, menuId)
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
        defaultLanguage={data.defaultLanguage as LanguageCode}
        supportedLanguages={data.supportedLanguages as LanguageCode[]}
        initialCategories={data.categories}
      />
    </DashboardPage>
  )
}
