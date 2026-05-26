# Security audit

Living document — every threat we evaluated, status, and where the mitigation lives. Update on resolution, on new CVE, or when a new class of attack appears.

> Identity now runs IN-PROCESS via `@iedora/auth` (better-auth) — see [`packages/auth/README.md`](../packages/auth/README.md). Sessions are owned by better-auth's `core.session` table; cookies seal on `.iedora.com` for cross-product SSO. The previous external-IdP threats (JWKS rotation, OIDC discovery, masterkey, Zitadel admin bootstrap) no longer apply.

## Threat register

Ranked by severity for the iedora stack.

| # | Threat | Severity | Status | Mitigation |
|---|---|---|---|---|
| 2 | Webhook SSRF — admin registers a URL pointing at internals | n/a | retired | No menu surface accepts admin-registered URLs today. Restore an SSRF guard before introducing one |
| 3 | Webhook replay | n/a | retired | Removed alongside threat #2. If/when we accept inbound webhooks again, reinstate the Stripe-style `x-iedora-signature: t=<ms>,v1=<hex>` + 5-min skew + envelope.id dedup pattern |
| 6 | [CVE-2026-45364](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html) — Better Auth IPv6 rate-limit bypass | medium | mitigated | better-auth is back in-process via `@iedora/auth`. Pinned to a patched release; Renovate auto-merges security advisories. Verify on each `better-auth` bump |
| 7 | [GHSA-wxw3-q3m9-c3jr](https://github.com/advisories) — Better Auth OAuth state mismatch w/o PKCE | n/a | retired | We don't use better-auth's OAuth-client flow today — auth is email+password with the organization + admin plugins. Reinstate the check if/when we add OIDC client flows |
| 19 | Multi-tenant IDOR (org-scoped data leakage) | medium | contained | menu's `requireRestaurantAccess` cross-checks the restaurant's `organizationId` against `auth.api.listOrganizations` for the active session. Audit any path reading org data outside this guard |
| 20 | Role escalation via mass-assignment | mitigated | done | `user.role` is `additionalFields: { role: { input: false } }` in `@iedora/auth` — not writable via public signup. The cross-tenant `iedora-admin` role is granted out-of-band only |
| 22 | CSRF on state-changing endpoints | mitigated | done | better-auth's built-in CSRF (Origin/Referer + trusted-origins allow-list driven by `IEDORA_CORE_TRUSTED_ORIGINS`) + SameSite=Lax on the `better-auth.session_token` cookie + Next 16 server actions |
| 25 | Sensitive-data logging | mitigated | done | `logger.level = 'error'` in production |
| 27 | Webhook secret encryption at rest | low | deferred | n/a today — no inbound webhooks. Revisit when external integrations land |
| 34 | `IEDORA_CORE_SECRET` leak | high | mitigated | Tofu-minted per Stage 4 (`DEPLOY_MENU_IEDORA_CORE_SECRET`), only present in the menu container's env; rotation invalidates all active sessions (documented in `deploy.md` § Secret rotation) |
| 35 | Cross-product cookie scope | medium | mitigated | Cookie domain pinned to `.iedora.com` via `IEDORA_CORE_COOKIE_DOMAIN`. Only first-party products under iedora.com see the session token; subdomain takeover risk handled by CF DNS being Tofu-managed |

## Supply-chain perimeter

Cross-cutting controls, independent of any single threat row. Gate the path from code → image → production.

| Layer | What it catches | Where | Action on red |
|---|---|---|---|
| **GitHub push protection** | Accidentally committed AWS/Stripe/PAT/etc.; blocks at protocol level | Repo Settings → Code security → Secret scanning + Push protection | Refused at `git push`. Rotate the leaked credential anyway |
| **GitHub secret scanning** | Secrets that landed before push protection was enabled | Same setting; Security → Secret scanning | Revoke, re-issue, force-push history if needed |
| **CodeQL (SAST)** | App-level taint: SQL injection, XSS, prototype pollution, command injection, hardcoded crypto. `security-extended` | `.github/workflows/codeql.yml`; push + PR + Mon 04:30 UTC | Triage in Security → Code scanning, fix root cause |
| **Trivy fs scan** | Known CVEs in workspace deps; HIGH/CRITICAL gates CI | `security` job in menu.yml | Bump dep (Renovate often has the PR); `.trivyignore` only if truly unfixable |
| **Trivy image scan** | OS-layer CVEs in the built image (Debian in `node:24-bookworm-slim`) | Post-deploy step in `infra-deploy.yml`; SARIF to Security tab | Renovate's `digest` rule auto-PRs the base-image refresh; rollback if actively exploitable |
| **Dependency Review** | HIGH+ CVE introduced by an open PR | `.github/workflows/dependency-review.yml` on pull_request | Renovate's typical author; bump to a patched range |
| **SLSA build provenance** | Authenticity: "this digest was built by this workflow at this commit" — Sigstore-signed, keyless via GH OIDC | `actions/attest-build-provenance@v3` in menu.yml; attached to GHCR image | Verify with `gh attestation verify oci://ghcr.io/eduvhc/menu:<sha> --owner eduvhc`. Failed = tampered |
| **SLSA SBOM attestation** | Trivy SBOM cryptographically bound to image digest | `actions/attest-sbom@v3`; pushed to GHCR | `gh attestation verify --type sbom` for audits |
| **Renovate** | Vulnerable deps + outdated base-image digests | `renovate.json`; weekly + immediate `[security]` PRs | Auto-merge handles minor/patch/digest + security advisories; majors land on dashboard |
| **Better Stack uptime** | Production reachability from outside our infra | 3 monitors at 3-min cadence; email alerts | Investigate; rollback if a recent deploy broke `/up` |

**Verify quarterly** via `gh api repos/eduvhc/iedora --jq '.security_and_analysis'`:

```
secret_scanning:                 enabled
secret_scanning_push_protection: enabled
dependabot_security_updates:     disabled  ← Renovate owns this lane
```

## Quick-win verifies (after every `better-auth` / `@iedora/auth` upgrade)

```bash
# 1. Session endpoint responds; cookie is scoped on .iedora.com
curl -si https://menu.iedora.com/api/auth/get-session | grep -iE 'set-cookie|content-type'
# expect: Set-Cookie: better-auth.session_token=...; Domain=.iedora.com; Secure; HttpOnly; SameSite=Lax; Path=/

# 2. CSRF: posting to a sign-in endpoint without a trusted Origin is rejected
curl -si -X POST -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.c","password":"x"}' \
  https://menu.iedora.com/api/auth/sign-in/email
# expect: 403 (better-auth CSRF guard rejects)
```

## Long-term gaps

- **MFA enforcement policy** for menu admin users. better-auth ships TOTP + Passkeys plugins; enable once the first paying customer asks for it.
- **Suspicious-activity events**: brute-force / unusual-location detection. Wire better-auth's hook surface to an audit-log table + OpenObserve dashboard.
- **SOC2-ready audit retention**: append-only ship to R2 monthly with cryptographically chained entries.

## References

- [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700)
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Svix Webhook Security](https://docs.svix.com/security)
- [better-auth security advisories](https://github.com/better-auth/better-auth/security/advisories)
