import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@iedora/product-menu/features/auth'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import { formatEditedAt } from '@iedora/product-menu/shared/ui/editorial-list'
import { CreateMenuDialog } from '@iedora/product-menu/features/menu-builder/ui/create-menu-dialog'
import { SeedSampleButton } from '@iedora/product-menu/features/menu-builder/ui/seed-sample-button'

/**
 * Restaurant home — single column, mobile-canonical.
 *
 * Layout: menu hero (the menu itself is the page's primary content;
 * tap → editor), then one labeled *section card* per action — QR ·
 * Settings · View public menu. Every action has equal weight, the
 * same tap target size, and the same rhythm. Mobile is the canonical
 * layout; desktop just widens the gutters.
 */
export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // i18n is independent of the restaurant lookup — kick it off
  // concurrently with the auth round-trip. The guard's single Go call
  // already returns the menu summaries alongside the restaurant.
  const tPromise = getTranslations('Restaurant')
  const tDashPromise = getTranslations('Dashboard')
  const localePromise = getLocale()
  const { restaurant: r, menus } = await requireRestaurantBySlug(slug)
  const primaryMenu = menus[0] ?? null

  const [t, tDash, locale] = await Promise.all([
    tPromise,
    tDashPromise,
    localePromise,
  ])

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
                    when: formatEditedAt(new Date(primaryMenu.updatedAt), locale),
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
        // Primary: seed a sample menu. Secondary: blank menu from
        // scratch. (The AI photo-import flow is gone until the Go
        // backend grows an import endpoint.)
        <section
          className="restaurant-empty"
          data-test-id="restaurant-empty"
        >
          <h2 className="restaurant-empty__title">{t('emptyTitle')}</h2>
          <p className="restaurant-empty__lede">{t('emptyLede')}</p>
          <div className="restaurant-empty__actions">
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
