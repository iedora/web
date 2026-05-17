# Genkan security audit (2026-05)

Living document. Records every threat we evaluated for the iedora identity service, what state it's in, and where the mitigation lives. Update when a threat is resolved, when a new CVE lands against our deps, or when a class of attack appears that we hadn't considered.

## Threat register

Ranked by severity for the iedora stack specifically.

| # | Threat | Severity | Status | Where the mitigation lives |
|---|---|---|---|---|
| 1 | MFA gap (TOTP / WebAuthn missing) | 🟥 high | open by design | pending feature; password-only sign-in until then |
| 2 | Webhook SSRF — admin registers a URL pointing at internals | 🟥 high | ✅ resolved | `packages/iedora-identity/src/ssrf.ts` — DNS + CIDR allowlist v4/v6, protocol guard, `allowPrivateNetworks` dev-only escape hatch (gated by `IEDORA_WEBHOOKS_ALLOW_PRIVATE=1` + `NODE_ENV!=production`) |
| 3 | Webhook replay | 🟧 medium | ✅ resolved | Stripe-style `x-iedora-signature: t=<ms>,v1=<hex>` over `${ts}.${body}`, receiver enforces 5 min skew window + idempotency dedup on envelope.id (in-process Map, swappable for Redis/Postgres) |
| 4 | OAuth authorization code reuse | 🟧 medium | ✅ resolved by upstream | Better Auth's `consumeVerificationValue` deletes the code on first exchange; second exchange → `invalid_grant`. Verified in `@better-auth/oauth-provider/dist/index.mjs` |
| 5 | Refresh-token replay detection (RFC 9700 § 4.13) | 🟧 medium | ✅ resolved by upstream | Replay of a revoked refresh token triggers `invalidateRefreshFamily(clientId, userId)` — kills all refresh + access tokens for that pair. Inline `TODO(invalidate-family-race)` upstream about non-atomic deletes; acceptable for v1 |
| 6 | [CVE-2026-45364](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html) — Better Auth IPv6 rate-limit bypass | 🟩 mitigated | ✅ | `advanced.ipAddress.ipv6Subnet: 64` in both apps' `better-auth-instance.ts` |
| 7 | [GHSA-wxw3-q3m9-c3jr](https://github.com/advisories) — Better Auth OAuth state mismatch w/o PKCE | 🟩 mitigated | ✅ | `require_pkce: true` on every seeded `oauth_client` row + `pkce: true` on menu's `generic-oauth` client |
| 8 | JWT algorithm confusion on consumer side | 🟧 medium | ✅ not applicable | menu uses authorization-code + PKCE + back-channel token exchange, so id_token integrity is guaranteed by TLS; `generic-oauth` doesn't verify the id_token signature (decodeJwt only). Vector only applies to the implicit flow which we don't use. TODO: revisit if menu starts validating tokens from anywhere other than its back-channel exchange |
| 9 | PKCE downgrade attack | 🟩 mitigated | ✅ | RFC 9700 § 4.6 fully covered |
| 10 | Open redirect via `redirect_uri` | 🟩 mitigated | ✅ | Better Auth's oauth-provider exact-string matches against `oauth_client.redirect_uris[]` |
| 11 | Mix-up attack | 🟩 N/A | ✅ | Each menu instance has exactly one IdP (genkan) — no multi-IdP attack surface |
| 12 | Account enumeration | 🟧 medium | 🟧 **partial leak** | sign-in is safe (identical 401 + ~equal timing for known vs unknown emails); **sign-up leaks** existing-email via `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422 vs 200). Accepted as a documented tradeoff per industry norm (Slack, Notion, GitHub all do this). Mitigate when an email sender lands: return generic 200 on signup, send "you already have an account" link out-of-band |
| 13 | Email verification bypass | 🟧 medium | ⏳ deferred | currently N/A — email/password is the only sign-in path and email verification isn't enforced. Becomes critical when a social provider is added; flip `requireEmailVerificationOnInvitation: true` then |
| 14 | Invitation token enumeration / weak entropy | 🟧 medium | ⏳ defaults | inherits Better Auth's defaults. Verify they're ≥128 bits + short TTL before any first paying customer arrives |
| 15 | Password reset token leakage (when reset flow added) | 🟧 medium | ⏳ N/A today | no reset flow yet. When added, never put the token in a hidden HTML input or a logged URL (cf. CVE-2026-26273) |
| 16 | Session fixation | 🟩 mitigated | ✅ | Better Auth rotates session tokens on every authentication event by default |
| 17 | Session cookie hygiene | 🟩 partial | ✅ | `Secure` + `HttpOnly` + `SameSite=Lax` + `__Secure-` prefix verified. `__Host-` prefix promotion deferred — would change cookie name and invalidate every existing session; tracked as `TODO(hardening)` in `better-auth-instance.ts` |
| 18 | TLS-trust on Cloudflare-Tunnel origin | 🟩 verified | ✅ | `advanced.useSecureCookies: true` explicit in both apps' Better Auth config |
| 19 | Multi-tenant IDOR (org-scoped data leakage) | 🟧 medium | ✅ contained | menu's `requireRestaurantAccess` checks `member` rows via the OIDC `organizations` claim; genkan's admin UI bypasses org-level checks (intentional — platform admins) but `requireAdmin` gates the route. Audit any path that reads org data outside `requireRestaurantAccess` |
| 20 | Role escalation via mass-assignment | 🟩 mitigated | ✅ | `user.role` is `additionalFields: { role: { input: false } }` — not writable through public signup |
| 21 | Reauthentication for destructive ops | 🟧 medium | 🟡 in flight | dispatched implementation: `requireFreshSession({ maxAgeMin })` DAL guard + `/reauth` page; applied to user/org/app/webhook destructive actions |
| 22 | CSRF on state-changing endpoints | 🟩 mitigated | ✅ | Better Auth Origin/Referer + SameSite + Next 16 server actions |
| 23 | `/oauth2/register` endpoint open | 🟩 mitigated | ✅ | explicit `allowDynamicClientRegistration: false` + `allowUnauthenticatedClientRegistration: false` on `oauthProvider`. Verified live: `curl -X POST .../oauth2/register` → 403 |
| 24 | `/oauth2/introspect` unauthenticated | 🟩 verified | ✅ | already requires `client_id` + `client_secret` per RFC 7662; verified live → 401 without creds |
| 25 | Sensitive-data logging | 🟩 mitigated | ✅ | `logger.level = 'error'` in production on both apps |
| 26 | Audit log on identity events | 🟧 medium | 🟡 in flight | dispatched implementation: real `audit_log` table + writes from every admin action + `/admin/audit` rewrite |
| 27 | Webhook secret encryption at rest | 🟨 low | ⏳ deferred | plaintext in DB. Acceptable while DB + app share a trust boundary; revisit when first external customer |
| 28 | Admin impersonation audit trail | 🟨 low | ⏳ part of #26 | Better Auth marks `session.impersonatedBy`; will be captured as a `user.impersonate` row in audit_log |
| 29 | Public JWKS rotation cadence | 🟨 low | 🟩 mitigated | 90-day automatic rotation via `src/features/auth/cron.ts` (started from `src/instrumentation.ts`) calling `rotateJwks()`. Multi-replica-safe via `pg_advisory_xact_lock(JWKS_ROTATION_LOCK_KEY=3828642905)` — CRC32 of `"jwks_rotation"`, same pattern as `audit_log_chain`. Manual emergency trigger at /admin/applications → "Rotate now" (step-up gated via `requireFreshSession`). Old keys retained indefinitely (`expiresAt = NULL`) so previously-signed tokens stay verifiable until their own `exp` claim |
| 30 | `/.well-known/*` cache poisoning | 🟨 low | 🟩 verified | Next route caches for 5 min; Cloudflare cache also 5 min — both below JWT lifetime |

## Quick-win verifies (run these after every Better Auth upgrade)

```bash
# 1. /oauth2/register rejected
curl -X POST https://genkan.iedora.com/api/auth/oauth2/register \
  -H content-type:application/json \
  -d '{"redirect_uris":["x"],"client_name":"x"}'
# expect: 403 + "Client registration is disabled"

# 2. /oauth2/introspect requires client creds
curl -X POST https://genkan.iedora.com/api/auth/oauth2/introspect -d 'token=abc'
# expect: 401

# 3. Sign-in returns identical 401 for known vs unknown email
curl -X POST https://genkan.iedora.com/api/auth/sign-in/email \
  -H content-type:application/json \
  -d '{"email":"<known>","password":"wrong"}'
# expect: 401 + "Invalid email or password" + identical timing for unknown email

# 4. /api/identity/organization/list requires bearer
curl https://genkan.iedora.com/api/identity/organization/list
# expect: 401 "missing_bearer_token"

# 5. Session cookie: Secure + __Secure- prefix + no Domain
curl -si https://genkan.iedora.com/api/auth/session | grep -i 'set-cookie'
# expect: __Secure-better-auth.session_token=... ; Secure; HttpOnly; SameSite=Lax; Path=/

# 6. Webhook delivery to a private IP rejected
# (run from a node REPL with the sender)
```

## Long-term gaps (strategic — when business need surfaces)

- **MFA**: TOTP first (Better Auth has `two-factor` plugin), then passkeys (`passkey` plugin). Required for `user.role==='admin'`; optional otherwise.
- **Suspicious-activity webhook events**: `auth.brute_force_detected`, `auth.unusual_login_location`, etc. emitted from rate-limit hooks.
- **SOC2-ready audit retention**: append-only ship to S3/R2 monthly; cryptographically chained entries.

## References

- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700)
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Svix Webhook Security](https://docs.svix.com/security)
- [Better Auth security advisories](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html)
