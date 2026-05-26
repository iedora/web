import 'server-only'
import { cache } from 'react'
import { drizzleQrCodesGateway } from './adapters/drizzle'
import { listCodes as runListCodes } from './use-cases/list-codes'
import { listForRestaurant as runListForRestaurant } from './use-cases/list-for-restaurant'
import { resolveCode as runResolveCode } from './use-cases/resolve'

/**
 * Public API of the qr-codes slice. Mutations live in `./actions.ts`
 * ('use server' doesn't traverse barrels — see AGENTS.md rule #14).
 *
 * `resolveQrCode` is the public-path lookup used by `/q/[code]`. It must
 * stay cheap (single indexed query) — anything we add here is on the hot
 * path of every sticker scan.
 *
 * `listQrCodesForAdmin` is the admin-page reader. Caller MUST have already
 * called `requireIedoraAdmin` — this function doesn't re-check, by design
 * (the page-level guard is the single source of truth).
 */

export const resolveQrCode = cache((code: string) =>
  runResolveCode(drizzleQrCodesGateway, code),
)

export const listQrCodesForAdmin = cache(() => runListCodes(drizzleQrCodesGateway))

/**
 * Tenant-scoped reader for the restaurant dashboard's QR page. Caller
 * MUST have already gated by `requireRestaurantBySlug` — this returns
 * raw rows scoped to the given restaurant id.
 */
export const listQrCodesForRestaurant = cache((restaurantId: string) =>
  runListForRestaurant(drizzleQrCodesGateway, restaurantId),
)

export type { QrCodeListRow, QrCodeResolved, QrCodeRow } from './ports'
