import 'server-only'
import type { LanguageCode } from '@/features/i18n'
import type { MenuReadPort } from '../ports'
import type { BuilderCategory } from '../ui/types'

export type BuilderData = {
  menu: { id: string; name: string }
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  categories: BuilderCategory[]
} | null

/**
 * RSC fetch for the builder page. Returns null when the menu doesn't exist
 * in the restaurant — the page maps that to `notFound()`. Language fallback
 * lives in the renderer (AGENTS.md hard rule #10); the builder shows raw
 * default-language text + the i18n maps so the editor can edit each tab.
 */
export async function loadBuilderData(
  port: MenuReadPort,
  restaurantId: string,
  menuId: string,
): Promise<BuilderData> {
  const data = await port.loadBuilderData(restaurantId, menuId)
  if (!data.menu) return null
  return {
    menu: data.menu,
    defaultLanguage: data.defaultLanguage as LanguageCode,
    supportedLanguages: data.supportedLanguages as LanguageCode[],
    categories: data.categories,
  }
}
