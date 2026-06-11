import Link from 'next/link'
import {
  LANGUAGE_META,
  type LanguageCode,
  getLanguage,
} from '../../i18n'
import type { ResolvedTheme } from './theme'
import { MenuRenderer } from './menu-renderer'
import type { PublicMenuData } from './types'

/**
 * Pure-presentation public-menu view. Same JSX the production page
 * mounts — so the admin live-preview reuses this verbatim (single
 * source of truth, no fork).
 *
 * Lives in a separate file from `public-menu-view.tsx` because the
 * latter pulls the Go-API loader (server-only); we want this rendering
 * code importable from client surfaces too.
 *
 * Two optional knobs for non-default consumers (e.g. the import IDE):
 *   - `onLanguageChange`: when set, the switcher renders local buttons
 *     that call back instead of `<Link>`-navigating. Lets the preview
 *     swap languages in-place without changing the URL.
 *   - `showBeacon`: defaults to true. The preview turns it off so we
 *     don't hammer the Go track endpoint with preview renders.
 */

export type PublicMenuLoaded = PublicMenuData & {
  theme: ResolvedTheme
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  currentLanguage: LanguageCode
}

export function PublicMenuView({
  data,
  onLanguageChange,
  showBeacon = true,
}: {
  data: PublicMenuLoaded
  onLanguageChange?: (lang: LanguageCode) => void
  showBeacon?: boolean
}) {
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
              const className =
                'rounded-full px-3 py-1 text-xs ' +
                (isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted')
              if (onLanguageChange) {
                return (
                  <button
                    type="button"
                    key={langMeta.code}
                    onClick={() => onLanguageChange(langMeta.code)}
                    data-testid={`lang-link-${langMeta.code}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={className}
                  >
                    {langMeta.nativeName}
                  </button>
                )
              }
              return (
                <Link
                  key={langMeta.code}
                  href={`/r/${data.restaurant.slug}?lang=${langMeta.code}`}
                  hrefLang={langMeta.code}
                  data-testid={`lang-link-${langMeta.code}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={className}
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
      {showBeacon && (
        // Pixel beacon — `/track/:slug` is rewritten by next.config.ts to the
        // Go menu service's `GET /public/track/:slug` 1×1 gif. Survives any
        // future edge cache layer in front of the page: the CDN may serve the
        // HTML from cache, but the browser still loads this image from the
        // origin, so the view is counted on every real visit.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/track/${data.restaurant.slug}`}
          alt=""
          aria-hidden="true"
          width={1}
          height={1}
          loading="eager"
          data-testid="view-beacon"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
