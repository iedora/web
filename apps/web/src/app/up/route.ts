/**
 * Healthcheck endpoint. Hit by the proxy + uptime monitors.
 *
 * The Next.js app holds no database connection anymore — data lives
 * behind the Go services, each with its own `/up`. This route only
 * proves the Next server itself is serving requests.
 * Bypasses every cache via `force-dynamic` so polls always reach origin.
 * Intentionally unauthenticated and must stay that way.
 */

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(
    { ok: true },
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  )
}
