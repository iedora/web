import 'server-only'
import { cache } from 'react'
import { ApiError } from '@iedora/api-client'
import * as api from '../../shared/api'
import { isValidQrCodeShape, normalizeQrCode } from './code'
import type { QrCodeListRow } from './stats'

/**
 * Public API of the qr-codes slice. Mutations live in `./actions.ts`
 * ('use server' doesn't traverse barrels — see AGENTS.md rule #14).
 * The QR registry itself lives in the Go menu service; these loaders
 * are thin, `cache()`-wrapped projections of its endpoints.
 */

export type { QrCodeListRow, QrStats } from './stats'

export type QrCodeResolved = {
  code: string
  restaurantSlug: string
}

function toRow(c: api.QRCode): QrCodeListRow {
  return {
    code: c.code,
    restaurantId: c.restaurantId ?? null,
    label: c.label ?? null,
    createdAt: c.createdAt,
    boundAt: c.boundAt ?? null,
    restaurant:
      c.restaurantId && c.restaurantName && c.restaurantSlug
        ? { id: c.restaurantId, name: c.restaurantName, slug: c.restaurantSlug }
        : null,
  }
}

/**
 * Public-path lookup used by `/q/[code]`. Cheap shape gate first so
 * garbage URLs never hit the service; unknown / unbound codes resolve
 * to null and the route 404s.
 */
export const resolveQrCode = cache(async (rawCode: string): Promise<QrCodeResolved | null> => {
  const code = normalizeQrCode(rawCode)
  if (!isValidQrCodeShape(code)) return null
  try {
    const { slug } = await api.resolveQRCode(code)
    return { code, restaurantSlug: slug }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
})

/**
 * Full registry for the staff admin surface. The Go service enforces
 * the staff role on the token; the page gates with `requireStaff`
 * first so the surface stays hidden from tenant users.
 */
export const listQrCodesForAdmin = cache(async (): Promise<QrCodeListRow[]> => {
  const { codes } = await api.listQRCodes()
  return codes.map(toRow)
})

/**
 * Cross-tenant restaurant refs for the admin bind dropdown (staff
 * only) — the whole point of the surface is binding stickers to any
 * restaurant regardless of tenant.
 */
export const listRestaurantsForBinding = cache(async () => {
  const { restaurants } = await api.listRestaurantRefs()
  return restaurants
})

/**
 * Bound stickers for one restaurant (tenant dashboard QR page). The Go
 * service has no per-restaurant QR endpoint — only the staff-wide list
 * — so we filter that list by restaurantId. Tenant operators don't hold
 * the staff role and get a 403 from the service; we surface that as an
 * empty shelf (the section simply doesn't render) rather than erroring
 * the page.
 */
export const listQrCodesForRestaurant = cache(
  async (restaurantId: string): Promise<QrCodeListRow[]> => {
    try {
      const { codes } = await api.listQRCodes()
      return codes.filter((c) => c.restaurantId === restaurantId).map(toRow)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return []
      throw err
    }
  },
)
