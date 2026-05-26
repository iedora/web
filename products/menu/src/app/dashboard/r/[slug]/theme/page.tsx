import { eq } from 'drizzle-orm'
import { getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { db } from '@/shared/db/client'
import { restaurant, type RestaurantTheme } from '@/shared/db/schema'
import { resolveTheme } from '@/features/menu-publishing/rsc/theme'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { loadMenuTree, localizeTree } from '@/features/menu-publishing'
import type { PublicMenu, PublicMenuData } from '@/features/menu-publishing/rsc/types'
import { ThemeEditor } from '@/features/restaurant-identity/ui/theme-editor'
import { DashboardPage } from '@/shared/ui/dashboard-page'

type EditorData = PublicMenuData & {
  rawTheme: RestaurantTheme | null
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  restaurantDescriptionI18n: LocalizedText
}

async function loadEditorData(restaurantId: string): Promise<EditorData> {
  const rows = await db
    .select({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      description: restaurant.description,
      logoUrl: restaurant.logoUrl,
      bannerUrl: restaurant.bannerUrl,
      theme: restaurant.theme,
      defaultLanguage: restaurant.defaultLanguage,
      supportedLanguages: restaurant.supportedLanguages,
      descriptionI18n: restaurant.descriptionI18n,
    })
    .from(restaurant)
    .where(eq(restaurant.id, restaurantId))
    .limit(1)

  const r = rows[0]!
  const defaultLanguage = r.defaultLanguage as LanguageCode

  // Editor preview shows the default-language strings — the renderer doesn't
  // know about i18n maps. Localize-to-default reuses the same helper as the
  // public page so any future field change lives in one place.
  const tree = await loadMenuTree({ restaurantId: r.id, activeOnly: true })
  const menus: PublicMenu[] = localizeTree(tree, defaultLanguage, defaultLanguage)

  return {
    restaurant: {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      logoUrl: r.logoUrl,
      bannerUrl: r.bannerUrl,
    },
    menus,
    rawTheme: r.theme as RestaurantTheme | null,
    defaultLanguage,
    supportedLanguages: r.supportedLanguages as LanguageCode[],
    restaurantDescriptionI18n:
      (r.descriptionI18n as LocalizedText | null) ?? {},
  }
}

export default async function ThemePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const data = await loadEditorData(r.id)
  const initialTheme = resolveTheme(data.rawTheme)
  const t = await getTranslations('Restaurant')

  return (
    <DashboardPage
      title={t('settings')}
      data-test-id="restaurant-theme"
      crumbs={[
        { label: r.name, href: `/dashboard/r/${slug}`, testId: 'restaurant' },
      ]}
    >
      <ThemeEditor
        slug={slug}
        restaurant={data.restaurant}
        restaurantDescriptionI18n={data.restaurantDescriptionI18n}
        menus={data.menus}
        initialTheme={initialTheme}
        initialLanguageSettings={{
          defaultLanguage: data.defaultLanguage,
          supportedLanguages: data.supportedLanguages,
        }}
      />
    </DashboardPage>
  )
}
