import 'server-only'
import Link from 'next/link'
import {
  LANGUAGE_META,
  type LanguageCode,
  getLanguage,
  localizedNullable,
  pickLanguage,
} from '@/features/i18n'
import { loadRestaurantSnapshot, localizeTree } from '..'
import { resolveTheme, type ResolvedTheme } from './theme'
import { MenuRenderer } from './menu-renderer'
import type { PublicMenuData } from './types'

/**
 * Shared loader + view for the public menu — same render at
 * `/r/[slug]` (branded URL) and `/q/[code]` (sticker URL). Extracted
 * here so the two route files stay thin shells: each does its own
 * params-lookup (slug vs code) then defers to this module.
 */

export type PublicMenuLoaded = PublicMenuData & {
  organizationId: string
  theme: ResolvedTheme
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  currentLanguage: LanguageCode
}

export async function loadPublicMenu(
  slug: string,
  requestedLang: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Promise<PublicMenuLoaded | null> {
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

/**
 * The actual JSX. Both /q/[code] and /r/[slug] render this. The slug
 * is always the CANONICAL value from the snapshot — the language
 * switcher hrefs and the tracking beacon both use it, so a user who
 * arrived via /q/[code] gets the slug-based language-switching URLs
 * (which is fine — we want shareable language permalinks pointing to
 * the branded URL).
 */
export function PublicMenuView({ data }: { data: PublicMenuLoaded }) {
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
                <Link
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
                </Link>
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
