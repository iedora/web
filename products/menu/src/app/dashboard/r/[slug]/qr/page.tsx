import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { listQrCodesForRestaurant } from '@/features/qr-codes'
import { RestaurantQrShelf } from '@/features/restaurant-identity/ui/restaurant-qr-shelf'
import { DashboardPage } from '@/shared/ui/dashboard-page'

export default async function QrPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const t = await getTranslations('Restaurant')

  // Build the public origin from the actual request host so QR codes work
  // behind tunnels (Cloudflare, ngrok) and on whatever domain the user
  // reaches the dashboard from. x-forwarded-host wins over host because
  // edge proxies set it to the public domain while host stays upstream.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const publicOrigin = `${proto}://${host}`
  const brandedUrl = `${publicOrigin}/r/${r.slug}`

  // Bound stickers, in boundAt-desc order. Date serialises to ISO so the
  // client component renders without a hydration mismatch.
  const stickerRows = await listQrCodesForRestaurant(r.id)
  const stickers = stickerRows.map((row) => ({
    code: row.code,
    label: row.label,
    boundAt: row.boundAt ? row.boundAt.toISOString() : null,
  }))

  return (
    <DashboardPage
      title={t('qrCode')}
      data-test-id="restaurant-qr"
      crumbs={[
        { label: r.name, href: `/dashboard/r/${slug}`, testId: 'restaurant' },
      ]}
    >
      <RestaurantQrShelf
        brandedUrl={brandedUrl}
        restaurantName={r.name}
        stickers={stickers}
        publicOrigin={publicOrigin}
      />
    </DashboardPage>
  )
}
