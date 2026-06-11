import { getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@iedora/product-menu/features/auth'
import { resolveTheme } from '@iedora/product-menu/features/menu-publishing/rsc/theme'
import type { PublicRestaurant } from '@iedora/product-menu/features/menu-publishing/rsc/types'
import { loadThemePreviewMenus } from '@iedora/product-menu/features/restaurant-identity'
import { ThemeEditor } from '@iedora/product-menu/features/restaurant-identity/ui/theme-editor'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import type { LanguageCode, LocalizedText } from '@iedora/product-menu/features/i18n'

export default async function ThemePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // i18n kicks off while the auth round-trip runs. The guard's Go
  // Restaurant DTO already carries everything the editor needs
  // (identity, theme, languages); only the preview menus need a
  // second call.
  const tPromise = getTranslations('Restaurant')
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const [menus, t] = await Promise.all([loadThemePreviewMenus(slug), tPromise])

  const restaurant: PublicRestaurant = {
    name: r.name,
    slug: r.slug,
    description: r.description,
    logoUrl: r.logoUrl,
    bannerUrl: r.bannerUrl,
  }

  // The Go DTO's theme is an opaque JSON map; resolveTheme coerces
  // partial / legacy shapes into a fully populated theme.
  const initialTheme = resolveTheme(r.theme as Parameters<typeof resolveTheme>[0])

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
        restaurant={restaurant}
        restaurantDescriptionI18n={(r.descriptionI18n ?? {}) as LocalizedText}
        menus={menus}
        initialTheme={initialTheme}
        initialLanguageSettings={{
          defaultLanguage: r.defaultLanguage as LanguageCode,
          supportedLanguages: r.supportedLanguages as LanguageCode[],
        }}
      />
    </DashboardPage>
  )
}
