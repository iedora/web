'use client'

import { useEffect, useRef, useTransition } from 'react'
import { signOutAction } from '@iedora/product-menu/features/auth/actions'

/**
 * Fires once on mount: runs the sign-out server action (which revokes
 * the Go session and clears the auth cookies, then redirects to
 * `next`). The StrictMode double-invocation in dev is gated by the
 * `done` ref so we don't double-sign-out.
 */
export function SignOutAction({ next }: { next: string }) {
  const done = useRef(false)
  const [, startTransition] = useTransition()
  useEffect(() => {
    if (done.current) return
    done.current = true
    startTransition(() => signOutAction(next))
  }, [next, startTransition])
  return null
}
