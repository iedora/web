import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { loadBuilderData } from '@/features/menu-builder'
import { MenuBuilder } from '@/features/menu-builder/ui/builder'

export default async function MenuBuilderPage({
  params,
}: {
  params: Promise<{ slug: string; menuId: string }>
}) {
  const { slug, menuId } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const data = await loadBuilderData(r.id, menuId)
  if (!data) notFound()

  const t = await getTranslations('Restaurant')

  return (
    <div className="space-y-6">
      <h1 className="flex flex-wrap items-baseline gap-2 text-sm font-normal text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          {t('back')}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/dashboard/r/${slug}`} className="hover:underline">
          {r.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold">{data.menu.name}</span>
      </h1>

      <MenuBuilder
        slug={slug}
        menuId={data.menu.id}
        restaurantId={r.id}
        defaultLanguage={data.defaultLanguage}
        supportedLanguages={data.supportedLanguages}
        initialCategories={data.categories}
      />
    </div>
  )
}
