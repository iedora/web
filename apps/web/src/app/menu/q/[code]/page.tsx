import { notFound, redirect } from 'next/navigation'
import { ApiError } from '@iedora/api-client'
import { resolveQRCode } from '@iedora/product-menu/features/menu-publishing'

/**
 * Sticker URL for the public menu. Scans land here; the Go menu
 * service resolves the code to its bound restaurant and we redirect
 * to the branded `/menu/r/[slug]` page (the canonical URL search
 * engines index). Unknown / unbound codes 404.
 */
export default async function StickerMenuPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  let slug: string
  try {
    ;({ slug } = await resolveQRCode(code))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }
  redirect(`/menu/r/${slug}`)
}
