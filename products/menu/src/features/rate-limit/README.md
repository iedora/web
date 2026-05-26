# `features/rate-limit`

Sliding-window rate limiting backed by Postgres. One slice for every per-actor cap in the app.

## Public API

```ts
import { enforceRateLimit, extractClientIp } from '@/features/rate-limit'

// Server action — `actor` is whatever bucket you want to throttle on.
const decision = await enforceRateLimit('presign', `org:${orgId}`)
if (!decision.ok) {
  return { ok: false, error: `Too many requests. Try again in ${decision.retryAfterSec}s.` }
}

// Route handler — pull the IP, normalize to /64 for IPv6.
const ip = extractClientIp(req) ?? 'unknown'
const decision = await enforceRateLimit('beacon', `ip:${ip}`)
```

## Policies

Defined in `policies.ts`. Each is `{ limit, windowMs, failClosed }`. The `failClosed` flag decides what happens when the database errors:

| Policy | Limit | Window | failClosed | Why |
|---|---|---|---|---|
| `presign` | 30 | 1m | true | Abuse here = R2 spend |
| `commit` | 60 | 1m | true | Mirrors presign |
| `clear` | 20 | 1m | false | Rare, low abuse value |
| `identity` | 30 | 1m | false | Settings tweaks |
| `onboarding` | 10 | 1h | false | Org creation |
| `beacon` | 600 | 1m | false | Pixel beacon must always 204 |
| `localeSet` | 30 | 1m | false | Cosmetic |

## Implementation

Single-table sliding-window log: `rate_limit_event(key, occurred_at)` with composite index `(key, occurred_at)`. Each check, inside one transaction:

1. `pg_advisory_xact_lock(hashtext(key))` — per-key serialization. Different keys never contend; same-key calls queue.
2. `DELETE` rows where `occurred_at < now - windowMs`.
3. `INSERT` a row for this attempt.
4. `SELECT count(*)` for the key → decide allow/deny.

The advisory lock is what makes this atomic under concurrent load — same guarantee the Redis `MULTI` block gave us. Without it, two `READ COMMITTED` transactions could both observe `count < limit` and both `INSERT` past it.

IPv6 client IPs are normalized to `/64` before keying (defends against the CVE-2026-45364-class bypass — walking a single /64 prefix to evade per-IP throttles).

## Tests

`rate-limit.test.ts` runs against **PGLite** — an actual Postgres-compatible engine in-process. No Docker, no mocks. The same 9-scenario coverage we had against real Redis:

- Allow under limit, deny over, refill after window
- Key isolation (`a` denies independently from `b`)
- **Atomic concurrent fire**: 50 parallel calls against limit=10 → exactly 10 admitted (proves `pg_advisory_xact_lock` works)
- Different-key parallelism (no cross-key blocking)
- Per-call pruning keeps the table bounded
- `retryAfterSec` accuracy
- Sustained traffic stays memory-bounded
- Fail-closed / fail-open policy paths

## Disabling

Set `DISABLE_RATE_LIMIT=true`. CI sets both this and `DISABLE_AUTH_RATE_LIMIT=true` so e2e suites can create users + upload assets in tight loops without tripping the limiter.

## Why not Redis?

We did use Redis (ZADD/ZREMRANGEBYSCORE in a MULTI block). For a single-node homelab Postgres handles the volume trivially (<100 ops/sec peak across all surfaces). Dropping Redis removed: 1 accessory, 1 BWS secret, 3 npm deps, testcontainers + OrbStack socket flakiness. The advisory-lock pattern matches Redis MULTI's atomicity at ~1.5ms-vs-0.5ms cost — invisible to users.
