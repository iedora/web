import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import {
  loadPublicMenu,
  PublicMenuView,
} from '@/features/menu-publishing/rsc/public-menu-view'

/**
 * Branded / marketing URL for the public menu. The QR sticker URL
 * `/q/[code]` is the other entry-point and renders the same content
 * (see `app/q/[code]/page.tsx`). This route is what we want indexed
 * by search engines and shared on social channels.
 */

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await loadPublicMenu(slug, sp.lang, h.get('accept-language'))
  if (!data) return { title: 'Menu not found' }
  return {
    title: `${data.restaurant.name} · Menu`,
    description:
      data.restaurant.description ?? `Digital menu for ${data.restaurant.name}.`,
    alternates: { canonical: `/r/${data.restaurant.slug}` },
  }
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const h = await headers()
  const data = await loadPublicMenu(slug, sp.lang, h.get('accept-language'))
  if (!data) notFound()
  return <PublicMenuView data={data} />
}
