import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

/**
 * Better Auth React client. Genkan's own auth pages (sign-in, sign-up,
 * onboarding) use this to call /api/auth/* on this same host. Sibling
 * products import THEIR own client pointed at https://genkan.iedora.com.
 *
 * `oauthProviderClient` is what lets these pages double as the
 * sign-in/sign-up landing inside an `/oauth2/authorize` flow: it sniffs
 * the signed `?sig=…` query off `window.location.search` and attaches it
 * as `oauth_query` to every non-GET request. The server's oauth-provider
 * before-hook captures it; the after-hook resumes the authorize step the
 * moment a session cookie is set; Better Auth's built-in `redirectPlugin`
 * follows the returned `data.url` back to the calling product. Without
 * it the forms have no way to carry the OAuth state forward.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient(), oauthProviderClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
