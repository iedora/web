import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { loadRestaurantAdminMenus } from '@/features/menu-publishing'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  EditorialList,
  formatEditedAt,
  formatIndex,
  type EditorialRowData,
} from '@/shared/ui/editorial-list'
import { CreateMenuDialog } from '@/features/menu-builder/ui/create-menu-dialog'
import { DeleteMenuButton } from '@/features/menu-builder/ui/delete-menu-button'
import { SeedSampleButton } from '@/features/menu-builder/ui/seed-sample-button'

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // Auth + tenant scoping (per request, uncached): the user must be a member
  // of the org owning this restaurant. The cached snapshot below trusts that
  // the slug is OK to read because this guard has run first.
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const t = await getTranslations('Restaurant')
  const tDash = await getTranslations('Dashboard')
  const locale = await getLocale()

  // Cached menus list, tagged `restaurant:${slug}` — invalidated by the same
  // `revalidateRestaurant(slug)` chokepoint the public page uses, so any
  // menu/category/item save the admin does is visible on the next render
  // without a separate revalidate call here.
  const snap = await loadRestaurantAdminMenus(slug)
  const menus = snap?.menus ?? []

  const rows: EditorialRowData[] = menus.map((m, i) => ({
    id: m.id,
    href: `/dashboard/r/${slug}/m/${m.id}`,
    title: m.name,
    index: formatIndex(i + 1),
    subtitle: (
      <span>{tDash('editedAt', { when: formatEditedAt(m.updatedAt, locale) })}</span>
    ),
    metadata: `${t('categoryCount', { count: m.categoryCount })} · ${t('dishCount', { count: m.dishCount })}`,
    extraActions: (
      <DeleteMenuButton slug={slug} menuId={m.id} menuName={m.name} />
    ),
  }))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-baseline gap-2 text-sm font-normal text-muted-foreground">
          <Link href="/dashboard" className="hover:underline">
            {t('back')}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-semibold">{r.name}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/dashboard/r/${slug}/theme`} />}
          >
            {t('settings')}
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/dashboard/r/${slug}/qr`} />}
          >
            {t('qrCode')}
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/r/${r.slug}`} target="_blank" rel="noreferrer" />}
          >
            {t('viewPublicMenu')}
          </Button>
        </div>
      </div>

      <EditorialList
        testId="menu-list"
        header={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-medium">{t('menus')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SeedSampleButton slug={slug} />
              <CreateMenuDialog slug={slug} />
            </div>
          </div>
        }
        rows={rows}
        emptyState={
          <Card>
            <CardHeader>
              <CardTitle>{t('noMenus')}</CardTitle>
              <CardDescription>{t('noMenusHint')}</CardDescription>
            </CardHeader>
          </Card>
        }
      />

    </div>
  )
}
