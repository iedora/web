'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@iedora/design-system'
import { signOutUrl } from '../../../shared/auth-urls'

export function LogoutButton() {
  const t = useTranslations('AppHeader')
  return (
    <Button
      variant="ghost"
      data-test-id="dashboard-logout"
      onClick={() => {
        // Redirect to the menu surface's sign-out flow, which
        // clears the auth cookies (so every iedora
        // product loses the session) and bounces the browser back to
        // the brand landing. Plain href navigation (no fetch) — the
        // top-level Set-Cookie response gets to the browser unwrapped.
        window.location.assign(signOutUrl(window.location.origin))
      }}
    >
      {t('logout')}
    </Button>
  )
}
