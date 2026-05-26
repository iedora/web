import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { loadRestaurantAdminMenus } from '@/features/menu-publishing'
import { DashboardPage } from '@/shared/ui/dashboard-page'
import { formatEditedAt } from '@/shared/ui/editorial-list'
import { CreateMenuDialog } from '@/features/menu-builder/ui/create-menu-dialog'
import { SeedSampleButton } from '@/features/menu-builder/ui/seed-sample-button'
import { ImportMenuDialog } from '@/features/menu-import/ui/import-menu-dialog'
import { UpdateMenuDialog } from '@/features/menu-import/ui/update-menu-dialog'
import type { PatchCurrentMenu } from '@/features/menu-import/ports'
import { loadMenuTree } from '@/features/menu-publishing/use-cases/load-tree'
import { AiTranslationDialog } from '@/features/menu-translation/ui/ai-translation-dialog'
import { eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { restaurant as restaurantTable } from '@/shared/db/schema'
import type { LanguageCode } from '@/features/i18n'

/**
 * Restaurant home — single column, mobile-canonical.
 *
 * The previous layout left actions scattered: one bold black button
 * (Update from photo) shouting over a row of tiny mono links (Translate
 * / Settings / QR) and a lonely link below (View public menu). Each
 * action had a different visual weight; nothing told the operator how
 * the actions related.
 *
 * The new layout treats each action as its own *section card*: serif
 * title, short editorial lede, then the affordance — a dialog trigger
 * for the AI flows, a chevron for the navigation ones. Every action
 * has equal weight, the same tap target size, and the same rhythm.
 *
 *   1. Menu hero (unchanged) — the menu itself is the hero. Tap → editor.
 *   2. Action sections — Update from photo · Translate · QR · Settings
 *      · View public menu. Each a labeled card; each one a single
 *      obvious tap target on a phone.
 *
 * Mobile is the canonical layout; desktop just widens the gutters.
 */
export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // Auth + tenant scoping. The cached snapshot below trusts that the
  // slug is OK to read because this guard ran first.
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const t = await getTranslations('Restaurant')
  const tDash = await getTranslations('Dashboard')
  const locale = await getLocale()

  const snap = await loadRestaurantAdminMenus(slug)
  const menus = snap?.menus ?? []
  const primaryMenu = menus[0] ?? null

  // Language config drives the AI Translation card visibility.
  const [langConfig] = await db
    .select({
      defaultLanguage: restaurantTable.defaultLanguage,
      supportedLanguages: restaurantTable.supportedLanguages,
    })
    .from(restaurantTable)
    .where(eq(restaurantTable.id, r.id))
    .limit(1)
  const defaultLanguage =
    (langConfig?.defaultLanguage as LanguageCode | undefined) ?? 'en'
  const supportedLanguages =
    (langConfig?.supportedLanguages as LanguageCode[] | null) ?? [
      defaultLanguage,
    ]
  const canTranslate = supportedLanguages.length > 1

  // Compact menu snapshot for the PATCH-update wizard — only id + name
  // + priceCents per item so the client payload stays small.
  let patchCurrent: PatchCurrentMenu | null = null
  if (primaryMenu) {
    const trees = await loadMenuTree({ restaurantId: r.id })
    const tree = trees.find((m) => m.id === primaryMenu.id)
    if (tree) {
      const firstItem = tree.categories
        .flatMap((c) => c.items)
        .find((it) => it.currency)
      patchCurrent = {
        language: defaultLanguage,
        currency: firstItem?.currency ?? 'EUR',
        categories: tree.categories.map((c) => ({
          id: c.id,
          name: c.name,
          items: c.items.map((it) => ({
            id: it.id,
            name: it.name,
            priceCents: it.priceCents,
          })),
        })),
      }
    }
  }

  return (
    // chrome="none" — on mobile the title block ate ~120px of vertical
    // space repeating what the sidebar already says (which restaurant
    // we're on). The menu hero card carries the restaurant identity
    // through its own content; the h1 stays for a11y + SEO.
    <DashboardPage
      title={r.name}
      data-test-id="restaurant"
      chrome="none"
    >
      {primaryMenu ? (
        <>
          {/* ── Menu hero ───────────────────────────────────────────
              The menu itself is the page's primary content. Tap → editor. */}
          <section data-test-id="restaurant-menu-section">
            <Link
              href={`/dashboard/r/${slug}/m/${primaryMenu.id}`}
              data-test-id={`restaurant-menu-card-${primaryMenu.id}`}
              className="restaurant-menu-card"
            >
              <div className="restaurant-menu-card__body">
                <h2 className="restaurant-menu-card__title">
                  {primaryMenu.name}
                </h2>
                <p className="restaurant-menu-card__meta">
                  {t('categoryCount', { count: primaryMenu.categoryCount })}
                  <span aria-hidden="true"> · </span>
                  {t('dishCount', { count: primaryMenu.dishCount })}
                  <span aria-hidden="true"> · </span>
                  {tDash('editedAt', {
                    when: formatEditedAt(primaryMenu.updatedAt, locale),
                  })}
                </p>
              </div>
              <span className="restaurant-menu-card__chevron" aria-hidden="true">
                ›
              </span>
            </Link>

            {/* Additional menus (rare) sit just under the hero. */}
            {menus.length > 1 && (
              <ul
                className="restaurant-menu-extra"
                data-test-id="restaurant-menu-extra-list"
              >
                {menus.slice(1).map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/dashboard/r/${slug}/m/${m.id}`}
                      data-test-id={`restaurant-menu-row-${m.id}`}
                      className="restaurant-menu-extra__row"
                    >
                      <span className="restaurant-menu-extra__name">
                        {m.name}
                      </span>
                      <span className="restaurant-menu-extra__meta">
                        {t('dishCount', { count: m.dishCount })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Action sections ─────────────────────────────────────
              Each action gets its own labeled card. Equal weight,
              identical rhythm — nothing shouts over the others. */}
          <div
            className="restaurant-actions"
            data-test-id="restaurant-actions"
          >
            {patchCurrent && (
              <section
                className="restaurant-action-card"
                data-test-id="restaurant-action-update"
              >
                <div className="restaurant-action-card__head">
                  <h3 className="restaurant-action-card__title">
                    {t('updateFromPhotoTitle')}
                  </h3>
                  <p className="restaurant-action-card__lede">
                    {t('updateFromPhotoLede')}
                  </p>
                </div>
                <div className="restaurant-action-card__cta">
                  <UpdateMenuDialog
                    slug={slug}
                    restaurantId={r.id}
                    menuId={primaryMenu.id}
                    current={patchCurrent}
                  />
                </div>
              </section>
            )}

            {canTranslate && (
              <section
                className="restaurant-action-card"
                data-test-id="restaurant-action-translate"
              >
                <div className="restaurant-action-card__head">
                  <h3 className="restaurant-action-card__title">
                    {t('translateTitle')}
                  </h3>
                  <p className="restaurant-action-card__lede">
                    {t('translateLede', {
                      count: supportedLanguages.length - 1,
                    })}
                  </p>
                </div>
                <div className="restaurant-action-card__cta">
                  <AiTranslationDialog
                    slug={slug}
                    defaultLanguage={defaultLanguage}
                    supportedLanguages={supportedLanguages}
                  />
                </div>
              </section>
            )}

            <Link
              href={`/dashboard/r/${slug}/qr`}
              className="restaurant-action-card restaurant-action-card--link"
              data-test-id="restaurant-action-qr"
            >
              <div className="restaurant-action-card__head">
                <h3 className="restaurant-action-card__title">
                  {t('qrCodeTitle')}
                </h3>
                <p className="restaurant-action-card__lede">
                  {t('qrCodeLede')}
                </p>
              </div>
              <span
                className="restaurant-action-card__chevron"
                aria-hidden="true"
              >
                ›
              </span>
            </Link>

            <Link
              href={`/dashboard/r/${slug}/theme`}
              className="restaurant-action-card restaurant-action-card--link"
              data-test-id="restaurant-action-settings"
            >
              <div className="restaurant-action-card__head">
                <h3 className="restaurant-action-card__title">
                  {t('settingsTitle')}
                </h3>
                <p className="restaurant-action-card__lede">
                  {t('settingsLede')}
                </p>
              </div>
              <span
                className="restaurant-action-card__chevron"
                aria-hidden="true"
              >
                ›
              </span>
            </Link>

            <Link
              href={`/r/${r.slug}`}
              target="_blank"
              rel="noreferrer"
              className="restaurant-action-card restaurant-action-card--link"
              data-test-id="restaurant-action-view"
            >
              <div className="restaurant-action-card__head">
                <h3 className="restaurant-action-card__title">
                  {t('viewPublicTitle')}
                </h3>
                <p className="restaurant-action-card__lede">
                  {t('viewPublicLede')}
                </p>
              </div>
              <span
                className="restaurant-action-card__chevron"
                aria-hidden="true"
              >
                ↗
              </span>
            </Link>
          </div>
        </>
      ) : (
        // ── Empty state ────────────────────────────────────────────
        // Hero with the two AI flows. Primary: photo. Secondary: sample.
        // We deliberately demote "blank menu from scratch" — the
        // operator rarely starts from nothing.
        <section
          className="restaurant-empty"
          data-test-id="restaurant-empty"
        >
          <h2 className="restaurant-empty__title">{t('emptyTitle')}</h2>
          <p className="restaurant-empty__lede">{t('emptyLede')}</p>
          <div className="restaurant-empty__actions">
            <ImportMenuDialog slug={slug} restaurantId={r.id} />
            <SeedSampleButton slug={slug} />
          </div>
          <div className="restaurant-empty__or">
            <span>{t('emptyOr')}</span>
            <CreateMenuDialog slug={slug} />
          </div>
        </section>
      )}
    </DashboardPage>
  )
}
