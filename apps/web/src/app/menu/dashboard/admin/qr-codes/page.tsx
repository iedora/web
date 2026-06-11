import { headers } from 'next/headers'
import { requireStaff } from '@iedora/product-menu/features/auth'
import {
  listQrCodesForAdmin,
  listRestaurantsForBinding,
} from '@iedora/product-menu/features/qr-codes'
import { computeQrStats } from '@iedora/product-menu/features/qr-codes/stats'
import { QrCodesAdmin } from '@iedora/product-menu/features/qr-codes/ui/qr-codes-admin'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'

/**
 * Cross-tenant admin surface for binding QR codes to restaurants.
 *
 * Gating order matters: `requireStaff` (session + role) FIRST, before
 * any service read — non-staff bounce to the dashboard without ever
 * seeing this surface. The Go menu service re-checks the staff role on
 * every call, so the guard here is UX, not the security boundary.
 *
 * The restaurant dropdown lists ALL restaurants across every tenant,
 * which is the whole point of the staff role; tenant scoping
 * deliberately does not apply here.
 */
export default async function QrCodesAdminPage() {
  await requireStaff()

  const [rows, restaurants] = await Promise.all([
    listQrCodesForAdmin(),
    listRestaurantsForBinding(),
  ])

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const publicOrigin = `${proto}://${host}`

  const stats = computeQrStats(rows)
  const snapshotAt = new Date().toISOString()

  return (
    <DashboardPage title="QR codes" data-test-id="qr-codes-admin">
      <QrCodesAdmin
        rows={rows}
        restaurants={restaurants}
        publicOrigin={publicOrigin}
        stats={stats}
        snapshotAt={snapshotAt}
      />
    </DashboardPage>
  )
}
