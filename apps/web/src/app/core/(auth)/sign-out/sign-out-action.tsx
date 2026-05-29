'use client'

import { useEffect, useRef } from 'react'
import { authClient } from '@iedora/core-auth/client'

/**
 * Fires once on mount: hits better-auth's sign-out endpoint (which
 * clears the cookie on `.iedora.com`) then navigates to `next`. The
 * StrictMode double-invocation in dev is gated by the `done` ref so
 * we don't double-sign-out.
 */
export function SignOutAction({ next }: { next: string }) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void (async () => {
      try {
        await authClient.signOut()
      } finally {
        window.location.assign(next)
      }
    })()
  }, [next])
  return null
}
