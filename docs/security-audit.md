# Security audit

Living document — every threat we evaluated, status, and where the mitigation lives. Update on resolution, on new CVE, or when a new class of attack appears.

> Identity-specific threats (MFA, OAuth flow hardening, JWKS rotation, etc.) lived in the deleted `genkan` IdP. They migrate to Zitadel — Zitadel inherits these mitigations by design. Re-evaluate against Zitadel during the menu cutover (issue #20).

## Threat register

Ranked by severity for the iedora stack.

| # | Threat | Severity | Status | Mitigation |
|---|---|---|---|---|
| 2 | Webhook SSRF — admin registers a URL pointing at internals | high | resolved | `packages/iedora-identity/src/ssrf.ts` — DNS + CIDR allowlist v4/v6, protocol guard, dev-only escape hatch (`IEDORA_WEBHOOKS_ALLOW_PRIVATE=1` + `NODE_ENV!=production`) |
| 3 | Webhook replay | medium | resolved | Stripe-style `x-iedora-signature: t=<ms>,v1=<hex>` over `${ts}.${body}`; receiver enforces 5 min skew + idempotency dedup on envelope.id |
| 6 | [CVE-2026-45364](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html) — Better Auth IPv6 rate-limit bypass | mitigated | done | `advanced.ipAddress.ipv6Subnet: 64` in menu's `better-auth-instance.ts` |
| 7 | [GHSA-wxw3-q3m9-c3jr](https://github.com/advisories) — Better Auth OAuth state mismatch w/o PKCE | mitigated | done | `pkce: true` on menu's `generic-oauth` client |
| 19 | Multi-tenant IDOR (org-scoped data leakage) | medium | contained | menu's `requireRestaurantAccess` checks `member` rows. Audit any path reading org data outside this guard |
| 20 | Role escalation via mass-assignment | mitigated | done | `user.role` is `additionalFields: { role: { input: false } }` — not writable via public signup |
| 22 | CSRF on state-changing endpoints | mitigated | done | Better Auth Origin/Referer + SameSite + Next 16 server actions |
| 25 | Sensitive-data logging | mitigated | done | `logger.level = 'error'` in production |
| 27 | Webhook secret encryption at rest | low | deferred | plaintext in DB. Acceptable while DB + app share a trust boundary; revisit on first external customer or once Zitadel-driven webhooks land |
| 31 | Zitadel masterkey leak | high | mitigated | `INFRA_ZITADEL_MASTERKEY` in BWS, 32 chars, never rotated casually. Documented re-key flow only |
| 32 | Zitadel admin user takeover via bootstrap password | medium | mitigated | `INFRA_ZITADEL_FIRST_ADMIN_PASSWORD` honored only on first boot; live rotation via UI |
| 33 | `auth.iedora.com` cert / TLS misconfig | mitigated | done | Caddy on the VPS terminates TLS via Let's Encrypt; `obs.iedora.com`, `menu.iedora.com` follow the same path |

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
| **OpenSSF Scorecard** | Posture: token permissions, dangerous workflows, pinned actions, fuzzing, branch protection | `.github/workflows/scorecard.yml`; weekly Mon 05:00 UTC | Two intentional low scores (Branch-Protection off; Code-Review solo) — accept and document |
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

## Quick-win verifies (after every Better Auth upgrade)

```bash
# 1. Sign-in returns identical 401 for known vs unknown email
curl -X POST https://menu.iedora.com/api/auth/sign-in/email \
  -H content-type:application/json \
  -d '{"email":"<known>","password":"wrong"}'
# expect: 401 + "Invalid email or password"

# 2. Session cookie: Secure + __Secure- prefix + no Domain
curl -si https://menu.iedora.com/api/auth/session | grep -i 'set-cookie'
# expect: __Secure-better-auth.session_token=... ; Secure; HttpOnly; SameSite=Lax; Path=/
```

## Long-term gaps

- **MFA** for menu admin users. Resolved once Zitadel is the IdP (ships TOTP + WebAuthn + Passkeys).
- **Suspicious-activity events**: brute-force / unusual-location detection. Wait for Zitadel cutover so this lives at the IdP layer.
- **SOC2-ready audit retention**: append-only ship to R2 monthly with cryptographically chained entries.

## References

- [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700)
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Svix Webhook Security](https://docs.svix.com/security)
- [Zitadel security model](https://zitadel.com/docs/concepts/architecture/secrets)
- [Better Auth security advisories](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html)
