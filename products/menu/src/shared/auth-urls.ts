/**
 * Canonical auth-page URLs. The auth flow (sign-in / sign-up /
 * sign-out) lives under the menu surface — `menu.iedora.com/sign-in`
 * in prod, `http://localhost:3000/menu/sign-in` in dev (both resolved
 * via `NEXT_PUBLIC_MENU_URL` through `productUrl`).
 *
 * Pure strings + URL builders — no env validation, no I/O, safe to
 * import from server AND client components (and the proxy middleware).
 */

import { PRODUCTS, productUrl } from '@iedora/brand'

const SIGN_IN_PATH = '/sign-in'
const SIGN_UP_PATH = '/sign-up'
const SIGN_OUT_PATH = '/sign-out'

/**
 * Builds an absolute sign-in URL. `next` should be an absolute URL on
 * a trusted iedora-family origin (redirect target after auth); the
 * sign-in page re-validates.
 */
export function signInUrl(next?: string): string {
  return appendNext(`${productUrl(PRODUCTS.menu)}${SIGN_IN_PATH}`, next)
}

export function signUpUrl(next?: string): string {
  return appendNext(`${productUrl(PRODUCTS.menu)}${SIGN_UP_PATH}`, next)
}

export function signOutUrl(next?: string): string {
  return appendNext(`${productUrl(PRODUCTS.menu)}${SIGN_OUT_PATH}`, next)
}

function appendNext(base: string, next?: string): string {
  if (!next) return base
  return `${base}?next=${encodeURIComponent(next)}`
}
