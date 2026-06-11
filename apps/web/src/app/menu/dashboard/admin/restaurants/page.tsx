import { requireStaff } from '@iedora/product-menu/features/auth'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import { listRestaurantsDirectory } from '@iedora/product-menu/features/restaurant-identity'
import { RestaurantsTable, type AdminRestaurantRow } from './restaurants-table'

/**
 * Cross-tenant restaurants directory (staff only). Lists every
 * restaurant on the platform with usage counters from the Go menu
 * service's staff directory. Filter / sort happen client-side over the
 * loaded set.
 *
 * Restaurant creation always lands in the CALLER'S tenant on the Go
 * side, so the old "create with a fresh tenant + transfer to the
 * client" admin flow is gone — provisioning for a client now happens
 * through the client's own onboarding.
 */
export default async function AdminRestaurantsPage() {
  await requireStaff()

  const raw = await listRestaurantsDirectory()

  const rows: AdminRestaurantRow[] = raw.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    tenantId: r.tenantId,
    menuCount: r.menuCount,
    dishCount: r.dishCount,
    views30d: r.views30d,
    updatedAt: r.updatedAt,
  }))

  return (
    <DashboardPage
      title="Restaurantes"
      description="Cross-tenant. Todos os restaurantes da plataforma, com utilização dos últimos 30 dias."
      data-test-id="admin-restaurants"
    >
      <section
        className="space-y-3"
        aria-labelledby="admin-restaurants-list-heading"
        data-test-id="admin-restaurants-list"
      >
        <h2
          id="admin-restaurants-list-heading"
          className="font-[family-name:var(--serif)] text-lg"
        >
          Todos os restaurantes
        </h2>

        <RestaurantsTable rows={rows} />
      </section>
    </DashboardPage>
  )
}
