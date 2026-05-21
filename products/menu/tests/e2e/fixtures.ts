import { test as base, type Page, type BrowserContext } from '@playwright/test'
import { truncateAll } from './helpers/db'
import { signInAs, type SignedInUser } from './helpers/sign-in'

export { expect } from '@playwright/test'

type Fixtures = {
  pageErrors: string[]
  signedInPage: Page
  signInNewUser: (label?: string) => Promise<{
    context: BrowserContext
    page: Page
    user: SignedInUser
  }>
  resetMenu: () => Promise<void>
}

export const test = base.extend<Fixtures>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []

      page.on('pageerror', (err) => {
        errors.push(`Uncaught client error: ${err.message}`)
      })

      page.on('response', async (response) => {
        if (response.status() < 500) return
        const ct = response.headers()['content-type'] ?? ''
        if (!ct.startsWith('text/html') && !ct.startsWith('text/x-component'))
          return

        const body = await response.text().catch(() => '')
        const snippet =
          body.match(/"message":"([^"]+)"/)?.[1] ??
          body.match(/<pre[^>]*>([^<]+)<\/pre>/)?.[1] ??
          body.slice(0, 400)
        errors.push(
          `Server ${response.status()} on ${new URL(response.url()).pathname}\n  ${snippet}`,
        )
      })

      await page.emulateMedia({ reducedMotion: 'reduce' })

      await use(errors)

      if (errors.length > 0) {
        throw new Error(
          `Page reported ${errors.length} uncaught error(s):\n\n${errors.join('\n\n')}`,
        )
      }
    },
    { auto: true },
  ],

  resetMenu: async ({}, use, testInfo) => {
    await use(async () => {
      await truncateAll()
    })
    try {
      await truncateAll()
    } catch (err) {
      if (testInfo.status !== 'passed') {
        return
      }
      console.warn('[fixtures] cleanup failed:', err)
    }
  },

  signedInPage: async ({ browser }, use) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signInAs(context, { email: 'admin@iedora.test', name: 'Iedora Admin' })
    await use(page)
    await context.close()
  },

  signInNewUser: async ({ browser }, use) => {
    const created: BrowserContext[] = []
    const helper = async (label = 'user') => {
      const context = await browser.newContext()
      created.push(context)
      const page = await context.newPage()
      const user = await signInAs(context, {
        email: `${label}@iedora.test`,
        name: `${label.charAt(0).toUpperCase() + label.slice(1)}`,
      })
      return { context, page, user }
    }
    await use(helper)
    for (const c of created) await c.close()
  },
})
