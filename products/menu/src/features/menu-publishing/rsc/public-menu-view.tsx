import 'server-only'
import { ApiError } from '@iedora/api-client'
import type { LanguageCode } from '../../i18n'
import { getPublicMenu } from '../../../shared/api'
import { resolveTheme } from './theme'
import { PublicMenuView, type PublicMenuLoaded } from './public-menu-view-ui'

/**
 * Server entrypoint: public-payload loader + view re-export. The JSX
 * lives in `./public-menu-view-ui.tsx` (no `server-only`) so client
 * surfaces (admin import IDE live preview) can mount the exact same
 * component.
 *
 * The Go menu service owns language negotiation (`?lang=` beats
 * `Accept-Language` beats the restaurant default) and returns the tree
 * already localized — no client-side i18n fallback happens here.
 */

export { PublicMenuView, type PublicMenuLoaded }

export async function loadPublicMenu(
  slug: string,
  requestedLang: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Promise<PublicMenuLoaded | null> {
  let payload
  try {
    payload = await getPublicMenu(
      slug,
      requestedLang ?? undefined,
      acceptLanguage ?? undefined,
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }

  return {
    restaurant: payload.restaurant,
    menus: payload.menus,
    theme: resolveTheme(payload.restaurant.theme),
    defaultLanguage: payload.defaultLanguage as LanguageCode,
    supportedLanguages: payload.supportedLanguages as LanguageCode[],
    currentLanguage: payload.currentLanguage as LanguageCode,
  }
}
