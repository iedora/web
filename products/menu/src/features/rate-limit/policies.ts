/**
 * Named rate-limit policies. One source of truth so a future tuning pass
 * doesn't need to grep every action.
 *
 * `failClosed: true` → if the limiter backend is unreachable, REJECT the request.
 * Used for surfaces where abuse cost outweighs availability (auth, presign).
 * `failClosed: false` → on backend outage, ALLOW the request. Used for
 * cosmetic / fire-and-forget surfaces where a flaky limiter must not break UX.
 *
 * Limits are per (key, window). Keys are constructed by the caller and
 * already include the actor (org/ip) and the policy name, e.g.
 *   rl:presign:org:abc123
 */
export type Policy = {
  name: string
  limit: number
  windowMs: number
  failClosed: boolean
}

const MIN = 60_000
const HOUR = 60 * MIN

export const POLICIES = {
  // 30 presigns / minute per org. Banner uploads chunk to S3 directly, so a
  // legit drag-and-drop session is ~3-5 presigns/min. Bulk-photo workflows
  // for an item-photo gallery might burst to 10-15.
  presign: { name: 'presign', limit: 30, windowMs: MIN, failClosed: true },

  // Commit ratio ~1:1 with presign — same envelope.
  commit: { name: 'commit', limit: 60, windowMs: MIN, failClosed: true },

  // Clearing an asset is rare. Keep tight to discourage rapid toggling.
  clear: { name: 'clear', limit: 20, windowMs: MIN, failClosed: false },

  // Theme + identity writes — usually settled in a single session.
  identity: { name: 'identity', limit: 30, windowMs: MIN, failClosed: false },

  // Org creation: at most a handful per hour from one IP. Pre-auth surface.
  onboarding: { name: 'onboarding', limit: 10, windowMs: HOUR, failClosed: false },

  // View beacon — per-IP. The (visitor cookie, hour-bucket) dedup in
  // view_seen handles the legitimate case; this stops bot floods.
  beacon: { name: 'beacon', limit: 600, windowMs: MIN, failClosed: false },

  // Cosmetic locale switch — anonymous, tight cap is fine.
  localeSet: { name: 'locale-set', limit: 30, windowMs: MIN, failClosed: false },
} as const satisfies Record<string, Policy>

export type PolicyName = keyof typeof POLICIES
