import { toNextJsHandler } from '@iedora/auth/next'
import { auth } from '@/shared/auth'

/**
 * Catch-all auth API route. better-auth handles every sub-path under
 * `/api/auth/*` (`/sign-in/email`, `/sign-up/email`, `/sign-out`,
 * `/get-session`, `/organization/*`, `/admin/*`, …).
 *
 * The single `[...all]` handler replaces the per-flow OIDC routes the
 * Zitadel integration needed (`login`, `callback`, `logout`).
 */
export const { GET, POST } = toNextJsHandler(auth.handler)
