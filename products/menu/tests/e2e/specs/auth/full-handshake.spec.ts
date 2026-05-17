import { expect, test } from '../../fixtures'
import { completeOAuthFlow } from '../../helpers/oauth-flow'
import { uniqueUser } from '../../helpers/seed'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('OIDC handshake — anonymous → /onboarding', () => {
  test(
    'sign up via the testkit, OAuth code-exchange, menu cookie set, lands on /onboarding',
    async ({ page }) => {
      const user = uniqueUser('handshake')

      // The OAuth flow needs more than the 5s default expect timeout —
      // genkan's signup form, code mint, callback, and onboarding render
      // each take a few hundred ms even on PGLite.
      test.setTimeout(20_000)

      // `NEXT_PUBLIC_GENKAN_URL` is set to the testkit URL in
      // playwright.config.ts and ci.yml — that's the build-time override
      // brand.ts already supports, so the landing's "Get started" CTA
      // resolves to the testkit (not the production genkan.iedora.com).

      await completeOAuthFlow(page, user)

      // Land on /onboarding with the "name the room" copy from page.tsx.
      await expect(page).toHaveURL(/\/onboarding(\?|$)/)
      await expect(page.getByText('name the room')).toBeVisible()
    },
  )
})
