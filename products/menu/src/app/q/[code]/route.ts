import { NextRequest, NextResponse } from 'next/server'
import { resolveQrCode } from '@/features/qr-codes'

/**
 * Public sticker-resolver. `GET /q/<code>` looks up the code in the
 * cross-tenant `qr_code` registry and 302s to `/r/<slug>` of the bound
 * restaurant. Unknown, unbound, or malformed codes all 404 — we don't leak
 * whether a sticker exists.
 *
 * Cached intentionally NOT — the binding can change at any time (admin
 * rebinds a sticker to a different restaurant) and the redirect is the
 * sole signal a scanner sees. A few ms per scan is fine; the public menu
 * page itself is cache-tagged downstream.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params
  const resolved = await resolveQrCode(code)
  if (!resolved) {
    return new NextResponse(null, { status: 404 })
  }
  // Relative redirect keeps the host the visitor reached us on — works
  // behind tunnels (ngrok, cloudflare) without round-tripping through
  // MENU_PUBLIC_URL.
  return NextResponse.redirect(
    new URL(`/r/${resolved.restaurantSlug}`, _req.nextUrl.origin),
    { status: 302 },
  )
}
