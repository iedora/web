import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { resolveTheme, type ResolvedTheme } from '@/features/menu-publishing/rsc/theme'
import {
  LANGUAGE_META,
  type LanguageCode,
  getLanguage,
  localizedNullable,
  pickLanguage,
} from '@/features/i18n'
import {
  loadRestaurantSnapshot,
  localizeTree,
} from '@/features/menu-publishing'
import { MenuRenderer } from '@/features/menu-publishing/rsc/menu-renderer'
import type { PublicMenuData } from '@/features/menu-publishing/rsc/types'

type LoadedRestaurant = PublicMenuData & {
  organizationId: string
  theme: ResolvedTheme
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  currentLanguage: LanguageCode
}

/**
 * Resolves the cached snapshot for `slug`, then localizes it based on the
 * visitor's language preference. The DB queries live inside `loadRestaurantSnapshot`
 * (cached, tag-invalidated on mutations); the localization step is a pure
 * in-memory transform that runs per request — cheap, depends on request input.
 */
async function loadRestaurantForRequest(
  slug: string,
  requestedLang: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Promise<LoadedRestaurant | null> {
  const snap = await loadRestaurantSnapshot(slug)
  if (!snap) return null

  const currentLanguage = pickLanguage({
    requested: requestedLang,
    acceptLanguage,
    supported: snap.supportedLanguages,
    defaultLanguage: snap.defaultLanguage,
  })

  const menus = localizeTree(snap.tree, currentLanguage, snap.defaultLanguage)

  return {
    restaurant: {
      id: snap.id,
      name: snap.name,
      slug: snap.slug,
      description: localizedNullable(
        snap.description,
        snap.descriptionI18n,
        currentLanguage,
        snap.defaultLanguage,
      ),
      logoUrl: snap.logoUrl,
      bannerUrl: snap.bannerUrl,
    },
    organizationId: snap.organizationId,
    menus,
    theme: resolveTheme(snap.theme),
    defaultLanguage: snap.defaultLanguage,
    supportedLanguages: snap.supportedLanguages,
    currentLanguage,
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await loadRestaurantForRequest(
    slug,
    sp.lang,
    h.get('accept-language'),
  )
  if (!data) return { title: 'Menu not found' }
  return {
    title: `${data.restaurant.name} · Menu`,
    description:
      data.restaurant.description ?? `Digital menu for ${data.restaurant.name}.`,
  }
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await loadRestaurantForRequest(
    slug,
    sp.lang,
    h.get('accept-language'),
  )
  if (!data) notFound()

  const showSwitcher = data.supportedLanguages.length > 1
  const langMetaCurrent = getLanguage(data.currentLanguage)
  return (
    <div
      lang={data.currentLanguage}
      dir={langMetaCurrent?.dir ?? 'ltr'}
      data-testid="public-menu-root"
    >
      {showSwitcher && (
        <nav
          aria-label="Language"
          data-testid="language-switcher"
          className="flex justify-end gap-1 px-5 pt-4"
        >
          {data.supportedLanguages
            .map((code) => LANGUAGE_META.find((m) => m.code === code))
            .filter((m): m is (typeof LANGUAGE_META)[number] => Boolean(m))
            .map((langMeta) => {
              const isActive = langMeta.code === data.currentLanguage
              return (
                <a
                  key={langMeta.code}
                  href={`/r/${data.restaurant.slug}?lang=${langMeta.code}`}
                  hrefLang={langMeta.code}
                  data-testid={`lang-link-${langMeta.code}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={
                    'rounded-full px-3 py-1 text-xs ' +
                    (isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted')
                  }
                >
                  {langMeta.nativeName}
                </a>
              )
            })}
        </nav>
      )}
      <MenuRenderer
        restaurant={data.restaurant}
        menus={data.menus}
        theme={data.theme}
      />
      {/* Pixel beacon — survives any future edge cache layer in front of the
        page. The CDN may serve the HTML from cache, but the browser still
        loads this image from the origin, so `/api/track/[slug]` runs on
        every real visit. See features/menu-publishing/cache.ts. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/track/${data.restaurant.slug}?lang=${data.currentLanguage}`}
        alt=""
        aria-hidden="true"
        width={1}
        height={1}
        data-testid="view-beacon"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
