import 'server-only'
import { SAMPLE_MENU, SAMPLE_MENU_NAME, buildI18n, pickDefault } from '@/features/menu-publishing'
import type { MenuWritePort, SampleMenuSeed } from '../ports'

export type SeedSampleMenuResult = { ok: true; menuId: string }

/**
 * Seeds a sample menu for a restaurant. The use-case reads the restaurant's
 * language config via the port, then localizes the static sample payload from
 * `@/features/menu-publishing` into the seed shape the port consumes. The
 * actual transaction lives in the adapter (AGENTS.md hard rule #7).
 *
 * Currency is fixed at EUR — same as the original action; localization of
 * currency is a separate concern.
 */
export async function seedSampleMenu(
  port: MenuWritePort,
  input: { restaurantId: string },
): Promise<SeedSampleMenuResult> {
  const { defaultLanguage, supportedLanguages } =
    await port.getRestaurantLanguageConfig(input.restaurantId)

  const seed: SampleMenuSeed = {
    menuName: {
      default: pickDefault(SAMPLE_MENU_NAME, defaultLanguage),
      i18n: buildI18n(SAMPLE_MENU_NAME, defaultLanguage, supportedLanguages),
    },
    categories: SAMPLE_MENU.map((c) => ({
      name: {
        default: pickDefault(c.name, defaultLanguage),
        i18n: buildI18n(c.name, defaultLanguage, supportedLanguages),
      },
      items: c.items.map((it) => ({
        name: {
          default: pickDefault(it.name, defaultLanguage),
          i18n: buildI18n(it.name, defaultLanguage, supportedLanguages),
        },
        description: {
          default: pickDefault(it.description, defaultLanguage),
          i18n: buildI18n(
            it.description,
            defaultLanguage,
            supportedLanguages,
          ),
        },
        priceCents: it.priceCents,
        currency: 'EUR',
      })),
    })),
  }

  const menuId = await port.seedSampleMenu(input.restaurantId, seed)
  return { ok: true, menuId }
}
