/**
 * Next 16 server-init hook. Runs once per Node process at startup, BEFORE
 * any request is served. Wire long-lived background jobs here so we don't
 * spin them up lazily off a request path.
 *
 * Today the only thing wired is the JWKS rotation cron. Gated on
 * `NEXT_RUNTIME === 'nodejs'` so the Edge/Workers build doesn't try to
 * import server-only Postgres code.
 *
 * Add new long-lived jobs by importing their `start*` function inside the
 * same `if (nodejs)` branch — keep imports dynamic so the Edge build
 * doesn't pull them in via static analysis.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('@/features/auth/cron')
    startCron()
  }
}
