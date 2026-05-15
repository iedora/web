import Link from 'next/link'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireRestaurantBySlug } from '@/features/auth'
import { QrViewer } from '@/features/restaurant-identity/ui/qr-viewer'

export default async function QrPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const t = await getTranslations('Restaurant')

  // Build the public URL from the actual request host so the QR works behind
  // tunnels (Cloudflare, ngrok) and on whatever domain the user reaches the
  // dashboard from. x-forwarded-host wins over host because edge proxies set
  // it to the public domain while host stays the upstream value.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const publicUrl = `${proto}://${host}/r/${r.slug}`

  return (
    <div className="space-y-6">
      <h1 className="flex flex-wrap items-baseline gap-2 text-sm font-normal text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          {t('back')}
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/dashboard/r/${slug}`}
          className="hover:underline"
        >
          {r.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold">{t('qrCode')}</span>
      </h1>

      <QrViewer publicUrl={publicUrl} restaurantName={r.name} />
    </div>
  )
}
