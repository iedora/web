/**
 * URL constants the auth slice owns. Spec files reference these instead
 * of hard-coding paths — if a route gets renamed (say `/login` → `/sign-in`),
 * one edit here and every spec follows.
 */
export const authRoutes = {
  login: (next?: string) =>
    next ? `/api/auth/login?next=${encodeURIComponent(next)}` : '/api/auth/login',
  callback: '/api/auth/callback',
  logout: '/api/auth/logout',
} as const
