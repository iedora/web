import type {
  PublicCategory,
  PublicItem,
  PublicMenu,
  PublicMenuPayload,
  PublicVariant,
} from '../../../shared/api'
import type { ResolvedTheme } from './theme'

/**
 * Render shapes for the public-menu templates. These are the Go menu
 * service's public read model (`GET /public/r/{slug}`) — already
 * localized server-side, so no i18n fallback logic lives in the
 * renderer. Type-only re-exports keep this module client-safe (the
 * `server-only` marker in shared/api is erased with the types).
 */

export type PublicRestaurant = PublicMenuPayload['restaurant']

export type { PublicCategory, PublicItem, PublicMenu, PublicVariant }

export type PublicMenuData = {
  restaurant: PublicRestaurant
  menus: PublicMenu[]
}

export type RenderProps = PublicMenuData & { theme: ResolvedTheme }
