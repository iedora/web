import { cookies } from 'next/headers'
import { db } from '@iedora/product-menu/shared/db/client'
import { viewSeen } from '@iedora/product-menu/shared/db/schema'
import {
  isLanguageCode,
  pickLanguage,
  type LanguageCode,
} from '@iedora/product-menu/features/i18n'
import { loadRestaurantSnapshot } from '@iedora/product-menu/features/menu-publishing'
import { incrementDailyView } from '@iedora/product-menu/features/metrics'
import { enforceRateLimit, extractClientIp } from '@iedora/product-menu/features/rate-limit'

/**
 * Pixel-beacon endpoint for public-menu view tracking. Decoupled from the
 * page render so it survives any future CDN/edge caching layer — the CDN will
 * cache `/r/[slug]` HTML, but `/api/track/*` returns `Cache-Control: no-store`
 * and always reaches the origin.
 *
 * Behaviour:
 *  - GET only, idempotent.
 *  - Identifies the visitor via a `mm_v` UUID cookie (set on first request).
 *  - Dedupes by `(visitor, restaurant, hour)` via the `view_seen` table —
 *    F5'ing 50× in 5 minutes still counts as one view.
 *  - Drops anything that smells like a bot at the user-agent layer.
 *  - Returns a 1×1 transparent GIF so an `<img>` tag in the page renders
 *    correctly (no broken-image icon, no network error logs).
 */

// Inlined 1×1 transparent GIF — cheaper than fetching an asset and keeps the
// endpoint self-contained.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

const VISITOR_COOKIE = 'mm_v'
const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year

// Crude UA filter — Googlebot, Bingbot, social-card scrapers, prerender bots,
// security scanners. We're not trying to be airtight; just stop the obvious
// double-digit-percent inflation that crawlers cause on viral menus.
const BOT_UA = /bot|crawl|spider|slurp|fetch|scrap|preview|facebookexternalhit|prerender|lighthouse|chrome-lighthouse|pingdom|monitor|uptime|curl|wget|httpclient|axios|python-requests/i

function pixelResponse(setCookieValue?: string): Response {
  const headers = new Headers({
    'content-type': 'image/gif',
    'content-length': String(PIXEL.byteLength),
    'cache-control': 'no-store, max-age=0',
    'pragma': 'no-cache',
  })
  if (setCookieValue) {
    headers.append(
      'set-cookie',
      `${VISITOR_COOKIE}=${setCookieValue}; Path=/; Max-Age=${VISITOR_TTL_SECONDS}; SameSite=Lax; HttpOnly`,
    )
  }
  return new Response(new Uint8Array(PIXEL), { headers })
}

function currentHourBucket(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}-${m}-${d}-${h}`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params

  const ua = request.headers.get('user-agent') ?? ''
  if (BOT_UA.test(ua)) return pixelResponse()

  // Per-IP throttle. Beacon must always 204 (fire-and-forget pixel), so the
  // policy is fail-open — if Redis is down the request still falls through
  // to the cookie-dedup'd insert. When over limit we still return the pixel
  // but skip the DB work; the visitor's browser is none the wiser.
  const ip = extractClientIp(request)
  if (ip) {
    const decision = await enforceRateLimit('beacon', `ip:${ip}`)
    if (!decision.ok) return pixelResponse()
  }

  // Cached snapshot — cheap. Gives us the restaurant id + org id + the set of
  // supported languages without an extra round-trip.
  const snap = await loadRestaurantSnapshot(slug)
  if (!snap) return pixelResponse()

  // Visitor cookie (uuid). Generated on first beacon; reused for the next
  // year so dedup is stable across sessions on the same device.
  const jar = await cookies()
  let visitorId = jar.get(VISITOR_COOKIE)?.value
  let setCookieValue: string | undefined
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
    visitorId = crypto.randomUUID()
    setCookieValue = visitorId
  }

  // Trust the page-supplied `lang` over Accept-Language: it's already
  // resolved through `pickLanguage` and matches what the visitor is actually
  // reading. We validate it's a registry code and falls within the
  // restaurant's supported set; otherwise re-pick from headers.
  const url = new URL(request.url)
  const langParam = url.searchParams.get('lang')
  const acceptLanguage = request.headers.get('accept-language')
  const language: LanguageCode =
    langParam && isLanguageCode(langParam) && snap.supportedLanguages.includes(langParam)
      ? langParam
      : pickLanguage({
          requested: null,
          acceptLanguage,
          supported: snap.supportedLanguages,
          defaultLanguage: snap.defaultLanguage,
        })

  // Idempotent dedup. The PK `(visitor, restaurant, hour)` guarantees one
  // counted view per visitor-restaurant-hour. Returning rows after
  // `onConflictDoNothing` is the canonical "was this row newly inserted?" check.
  const hourBucket = currentHourBucket()
  const inserted = await db
    .insert(viewSeen)
    .values({ visitorId, restaurantId: snap.id, hourBucket })
    .onConflictDoNothing()
    .returning({ visitorId: viewSeen.visitorId })

  if (inserted.length > 0) {
    // Fire-and-forget — a transient daily_view failure mustn't 500 the beacon
    // and waste the visitor's connection.
    void incrementDailyView(snap.id, snap.tenantId, language).catch(
      (err) => console.error('[track] view increment failed', err),
    )
  }

  return pixelResponse(setCookieValue)
}
