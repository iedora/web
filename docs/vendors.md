# Vendor register

Every external dependency in the iedora trust chain — who they are, what data they touch, how we know they handle it responsibly, when we last looked.

Required artifact for SOC 2 CC9 (Vendor management). Reviewed annually at minimum, or when a vendor materially changes their service / suffers an incident / is replaced.

**Owner**: Eduardo (solo founder). All vendor decisions and reviews land on his plate until the team grows.

**Last full review**: 2026-05-17.

---

## Tier 1 — Third-party SaaS (paid + contractual)

These vendors process customer data or hold the keys to it. Their compromise directly compromises us. Each must have a current SOC 2 report on file.

### Cloudflare

| | |
|---|---|
| **Service** | DNS + TLS termination + Cloudflare Tunnel (menu app on the Hetzner VPS) + R2 object storage (encrypted pg_dump backups + future asset uploads) + Workers Static Assets (iedora.com). `auth.iedora.com` (Zitadel) terminates TLS via Caddy directly on the VPS — no tunnel in front. |
| **Data they touch** | Every HTTP request and response in flight (Cloudflare terminates TLS at the edge for any hostname proxied through it). Backup data at rest (encrypted with `INFRA_BACKUP_PASSPHRASE` from BWS — Cloudflare sees ciphertext only). |
| **SOC 2 status** | Type II — current. Available via Cloudflare Trust Hub at https://www.cloudflare.com/trust-hub/compliance-resources/ |
| **Other compliance** | ISO 27001, ISO 27018, PCI DSS, FedRAMP Moderate |
| **DPA** | Standard Cloudflare DPA accepted at account-setup time |
| **What happens if they're compromised** | Attacker sees plaintext request bodies in flight (auth headers, OAuth codes, webhook payloads) for hostnames Cloudflare proxies. Mitigated by: short-lived OAuth tokens, PKCE, refresh-token replay detection. Encrypted backups stay encrypted at rest. |
| **Rotation / exit plan** | Workload tokens rotate via `tofu apply -replace=<resource>`. Switching providers means re-pointing DNS, replacing the tunnel with direct exposure (the VPS has public IPv4), migrating R2 → another S3-compatible store. Estimated 1-2 day project. |
| **Last reviewed** | 2026-05-19 |

### GitHub

| | |
|---|---|
| **Service** | Source code (private repos), GitHub Container Registry (production container images), GitHub Actions (CI) |
| **Data they touch** | Source code (no customer data in code). Container images we push. CI run logs (no customer data). |
| **SOC 2 status** | ✅ Type II — current. Available via GitHub Trust Center at https://github.com/security |
| **Other compliance** | ISO 27001/17/18, FedRAMP, PCI DSS |
| **DPA** | Microsoft / GitHub Customer Agreement (covers all repos under the personal account) |
| **What happens if they're compromised** | Attacker gets source code (already designed to be public-safe — no secrets in repo, BWS holds all credentials), container images (signed; integrity verifiable on pull). They can't deploy without `KAMAL_REGISTRY_PASSWORD` which is a separate token in BWS. |
| **Rotation / exit plan** | The `KAMAL_REGISTRY_PASSWORD` rotates via the GitHub UI + BWS update (5 min). Switching to GitLab / Gitea is a multi-week project (CI rewrite + image-registry migration). |
| **Last reviewed** | 2026-05-17 |

### Bitwarden Secrets Manager (BWS)

| | |
|---|---|
| **Service** | Production secret storage in project `iedora-deploy` (keys prefixed by ownership: `INFRA_*` for tofu/Cloudflare/Postgres/backups/GHCR; `MENU_*` for menu's session and OAuth secrets). |
| **Data they touch** | Plaintext secrets at rest (encrypted with Bitwarden's KMS). Access tokens we generate for the deploy machine. |
| **SOC 2 status** | Type II — current. Available via https://bitwarden.com/help/bitwarden-security-white-paper/ + SOC 2 report on request |
| **Other compliance** | ISO 27001, GDPR, HIPAA, SOC 3 (public) |
| **DPA** | Bitwarden DPA accepted at account-setup time |
| **What happens if they're compromised** | Attacker who steals the BWS access token AND project ID gets every production secret. The token is on **one** developer laptop (FileVault-encrypted) and is the single highest-value credential in the iedora system. Mitigated by: short access-token lifetime (rotate quarterly), FileVault on the laptop, Bitwarden's own audit logs. |
| **Rotation / exit plan** | Access token rotated via Bitwarden UI → BWS_ACCESS_TOKEN updated in each workspace's local `.env`. Per-secret rotation via `just <workspace>::rotate-secret <KEY>` (any of `infra::`, `menu::`). Switching providers (HashiCorp Vault, AWS Secrets Manager, age-encrypted file in repo) is a 1-day project — secrets are few and named. |
| **Last reviewed** | 2026-05-19 |

---

## Tier 2 — Infrastructure foundation

### Hetzner Cloud (VPS)

| | |
|---|---|
| **Service** | Single CAX11 VPS (Falkenstein, public IPv4) running Docker + every iedora container (menu, zitadel, postgres, openobserve, caddy, cloudflared, backups). |
| **Data they touch** | All production data at rest (Postgres data directory mounted on the box). Backup tarballs (encrypted before R2 upload). |
| **SOC 2 status** | n/a — Hetzner is ISO 27001 certified but does not publish a SOC 2 report. Compensating controls: SSH key-only auth (no password login), `ufw` allowlist on the public IPv4 (only 22 + 443 + Cloudflare-Tunnel-managed outbound), Caddy auto-TLS for `auth.iedora.com`. |
| **What happens if it's compromised** | Plaintext DB access. Mitigated by: SSH key-only login, public-port allowlist, daily encrypted backups to R2 (recovery point ≤ 24h), `just infra::restore` to a fresh box. Webhook secrets (encrypted at rest — see security audit #27) stay safe unless the attacker also has `MENU_AUTH_SECRET`. |
| **Rotation / exit plan** | Restore on a different host is a ~30-min runbook: stand up new VPS, install Docker, paste BWS token, `just infra::deploy && just infra::restore && just menu::deploy`. Switching cloud (DigitalOcean / OVH) is the same runbook — `ONPREM_HOST` is just an env value. |
| **Last reviewed** | 2026-05-19 |

---

## Tier 3 — Code dependencies (subprocessors in the SOC 2 sense)

These don't operate a service — they're OSS we run on customer data. Trust decision is based on community maintenance + audit history + a documented monitoring posture (we watch their CVE feeds).

### Better Auth

| | |
|---|---|
| **What we use it for** | Menu's local session layer (user/session/account). The federated IdP role previously held by genkan (Better Auth + OAuth provider) has been retired; identity moves to Zitadel under issue #19. |
| **License** | MIT |
| **Maintainer** | Bekacru — sole maintainer at landing time; project picked up by WorkOS in 2025 with active contributions. |
| **Known CVEs we track** | [CVE-2026-45364](https://www.cvedetails.com/product/177298/Better-auth-Better-Auth.html) (IPv6 rate-limit bypass — mitigated via `ipv6Subnet:64`), [GHSA-wxw3-q3m9-c3jr](https://github.com/advisories) (OAuth state mismatch w/o PKCE — mitigated via `require_pkce:true`). Both documented in `docs/security-audit.md`. |
| **Monitoring** | GitHub Advisory Database subscription on `better-auth` + manual review of release notes for every minor bump |
| **Replacement** | Auth.js / NextAuth, or — once Zitadel becomes the IdP — drop Better Auth from menu entirely and use plain OIDC session cookies. |
| **Last reviewed** | 2026-05-19 |

### Drizzle ORM

| | |
|---|---|
| **What we use it for** | Every DB query in menu. Schema definition, migrations, type-safe queries. |
| **License** | Apache 2.0 |
| **Maintainer** | drizzle-team (commercial backing) |
| **Known CVEs** | None tracked at time of review |
| **Monitoring** | GitHub Advisory Database |
| **Replacement** | Kysely or raw SQL via `postgres-js`. Replacement is a 1-2 week refactor; queries are written explicitly, not generated. |
| **Last reviewed** | 2026-05-17 |

### postgres-js (`postgres`)

| | |
|---|---|
| **What we use it for** | The Postgres driver Drizzle sits on top of. Direct usage in `migrate.mjs`, `encrypt-webhook-secrets.mjs`, `backfill-audit-chain.mjs`. |
| **License** | The Unlicense |
| **Maintainer** | porsager (Rasmus Porsager) |
| **Known CVEs** | None tracked at time of review |
| **Monitoring** | GitHub Advisory Database |
| **Replacement** | `node-postgres` (`pg`). Drop-in for Drizzle; the migration scripts would need minor API surface updates. 1-day project. |
| **Last reviewed** | 2026-05-17 |

### Next.js

| | |
|---|---|
| **What we use it for** | App framework for menu. Routing, rendering, server actions, middleware (proxy). |
| **License** | MIT |
| **Maintainer** | Vercel |
| **Known CVEs** | Regularly patched; we run 16.x and watch for upstream advisories. |
| **Monitoring** | GitHub Advisory Database + Vercel's security mailing list |
| **Replacement** | Not realistic — Next is the framework choice. Future products could pick alternatives (Remix, SolidStart). |
| **Last reviewed** | 2026-05-17 |

### React

| | |
|---|---|
| **What we use it for** | All UI. |
| **License** | MIT |
| **Maintainer** | Meta |
| **Known CVEs** | None tracked at time of review |
| **Monitoring** | GitHub Advisory Database |
| **Last reviewed** | 2026-05-17 |

### @iedora/* workspace packages

| | |
|---|---|
| **What we use** | Internal — `@iedora/design-system`, `@iedora/identity`, `@iedora/observability`. |
| **Trust model** | First-party; same review process as application code. Listed here for completeness so an auditor reading this doc can trace every import. |

---

## Review process

**Annually** (or sooner on incident):

1. Walk this register top to bottom. For each vendor:
   - Confirm the SOC 2 report is current (Tier 1)
   - Read their security advisories index since last review (all tiers)
   - Verify no breaking changes that affect our integration
   - Update "Last reviewed" date

2. Cross-reference against `docs/security-audit.md` — any new vendor or service surface added since the last vendor review needs an entry here.

3. Commit the diff. The git log is the audit trail of "we reviewed our vendors on this date".

**On incident** (any vendor breach, even one we don't directly use):

1. Read the disclosure
2. Check if any of our keys / data / configs were in scope
3. Rotate the relevant credential if there's any doubt (`just menu::rotate-secret` or `just infra::rotate-secret`)
4. Add an inline note under the relevant entry above + commit
5. If the vendor was Tier 1 and the breach was material, decide whether to migrate away

## Adding a new vendor

Before adopting a new third-party service:

1. **Tier 1 check**: do they have a current SOC 2 Type II? If they touch customer data and don't, find an alternative.
2. **Single-purpose principle**: each vendor should do one thing. Don't pick a vendor because it offers many things — pick because it does the specific thing well.
3. **Exit cost**: can we leave in under a week if they double their prices / get bought by someone we don't trust / shut down?
4. **Add an entry here** before the first production call. The entry IS the procurement decision record.

## What we deliberately don't use (and why)

For each capability where we picked the in-house / OSS path over a SaaS:

| Capability | What we don't use | What we do instead | Why |
|---|---|---|---|
| Identity | Auth0, Clerk, WorkOS, Stytch | Zitadel (self-hosted on the same Hetzner VPS; previously Better-Auth-based genkan) | Cost (hundreds of $/mo at small scale) + we wanted full control of the auth surface for the iedora estate |
| Observability | Datadog, Sentry, Honeycomb | Docker logs + `just menu::logs` | Single-operator; alerting is the operator's eyes. Will add Better Stack or similar when the operator can no longer keep up. |
| CI | CircleCI, Buildkite, GitLab CI | GitHub Actions | Already inside the GitHub trust boundary |
| Background jobs | Inngest, Trigger.dev | In-process `setInterval` (JWKS rotation) + database advisory locks | Cron-like work today is rare and small; reach for a real scheduler when that changes |
| Email | Resend, Postmark, SendGrid | (none yet — no transactional email today) | Add when the IdP needs to send password reset / invitation / verification emails. Resend is the likely default given its low-overhead DX. |
| Error tracking | Sentry, Bugsnag | Stderr to docker logs | Same reason as observability. Sentry is the likely default when it's added. |
