import { headers } from 'next/headers'
import { asc } from 'drizzle-orm'
import { requireScope, SCOPES } from '@/features/auth'
import { listQrCodesForAdmin } from '@/features/qr-codes'
import { computeQrStats } from '@/features/qr-codes/stats'
import { QrCodesAdmin } from '@/features/qr-codes/ui/qr-codes-admin'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import { DashboardPage } from '@/shared/ui/dashboard-page'

/**
 * Cross-tenant admin surface for binding QR codes to restaurants.
 *
 * Gating order matters: `requireIedoraAdmin` (cookie + role) FIRST, before
 * any DB read. Without the role the route 404s — we don't want to leak the
 * existence of this surface to tenant users.
 *
 * The restaurant dropdown lists ALL restaurants across every org, which is
 * the whole point of the admin role; tenant scoping deliberately does not
 * apply here.
 */
export default async function QrCodesAdminPage() {
  // Page-level gate is the most permissive scope this surface needs —
  // mutations are gated individually inside each server action.
  await requireScope(SCOPES.QR_CODES_READ)

  const [rows, restaurants] = await Promise.all([
    listQrCodesForAdmin(),
    db
      .select({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
      })
      .from(restaurant)
      .orderBy(asc(restaurant.name)),
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
