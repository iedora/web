import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import {
  loadPublicMenu,
  PublicMenuView,
} from '@/features/menu-publishing/rsc/public-menu-view'
import { resolveQrCode } from '@/features/qr-codes'

/**
 * Sticker URL for the public menu. Scans land here — we render the menu
 * INLINE instead of 302-ing to `/r/[slug]`, so:
 *
 *   - the URL bar stays at `/q/<code>` which preserves per-sticker
 *     analytics across bookmarks + shares.
 *   - one less round-trip on the scan path.
 *
 * The branded URL `/r/[slug]` is the canonical (`<link rel="canonical">`
 * below) so search engines index that one; humans typing the URL on a
 * business card or Instagram bio land on the same content via the
 * branded path.
 *
 * `resolveQrCode` is `React.cache()`-memoized in the slice so any
 * downstream consumer (generateMetadata + the page component) hits the
 * DB once per request.
 */

async function load(
  code: string,
  requestedLang: string | null | undefined,
  acceptLanguage: string | null | undefined,
) {
  const resolved = await resolveQrCode(code)
  if (!resolved) return null
  return loadPublicMenu(resolved.restaurantSlug, requestedLang, acceptLanguage)
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ lang?: string }>
}): Promise<Metadata> {
  const { code } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await load(code, sp.lang, h.get('accept-language'))
  if (!data) return { title: 'Menu not found', robots: { index: false } }
  return {
    title: `${data.restaurant.name} · Menu`,
    description:
      data.restaurant.description ?? `Digital menu for ${data.restaurant.name}.`,
    // SEO points at the branded URL; the sticker URL is for humans
    // who scanned, not for search engines.
    alternates: { canonical: `/r/${data.restaurant.slug}` },
  }
}

export default async function StickerMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { code } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await load(code, sp.lang, h.get('accept-language'))
  if (!data) notFound()
  return <PublicMenuView data={data} />
}
