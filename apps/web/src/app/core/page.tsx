import { redirect } from 'next/navigation'
import { getSession } from '@iedora/product-core'
import { isStaffUser } from '@iedora/core-auth/server'
import { PRODUCTS, productUrl } from '@iedora/brand'
import { signInUrl } from '@iedora/product-core/url'

/**
 * Root of the `core` product.
 *
 *   1. Not signed in → sign-in page.
 *   2. Signed in with a cross-tenant staff role (`iedora-admin` or
 *      `iedora-support`) → land on `/core/admin`. Staff visit core
 *      directly to reach the admin surface — that's the whole point
 *      of giving core its own host. Used to auto-redirect to menu,
 *      which trapped staff in tenant chrome.
 *   3. Signed in as a tenant → bounce to the menu app (today's
 *      default product).
 *
 * Note: callers that arrive via the sign-in flow with a `next` param
 * (e.g. clicking "Log in" on menu.iedora.com or imopush.iedora.com)
 * don't pass through here at all — the sign-in page honours `next`
 * directly. This file only handles direct hits to `core.iedora.com/`.
 *
 * When a second tenant-facing product opens beyond early access,
 * promote this to a product picker: resolve the user's accessible
 * products (org membership for menu, equivalent for imopush) and
 * render a chooser when there's more than one.
 */
export default async function CoreHome() {
  const session = await getSession()
  if (!session?.user) {
    redirect(signInUrl())
  }

  if (await isStaffUser(session.user.id)) {
    redirect('/core/admin')
  }

  redirect(productUrl(PRODUCTS.menu))
}
