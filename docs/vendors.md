# Vendor register

> Tiers, data exposure, SOC 2 status. Revisto anualmente.

**Owner:** Eduardo (solo founder).

## Tier 1 — Third-party SaaS

### Cloudflare

| | |
|---|---|
| **Service** | DNS, R2 (assets), Zero Trust Tunnel (ingress), TLS edge |
| **Data** | DNS records, R2 contents (assets), tunnel traffic (encrypted) |
| **SOC 2** | Type II — current |
| **Exit** | Migrar R2 para S3-compat + re-point DNS. ~2 dias |

### Gitea (self-hosted)

| | |
|---|---|
| **Service** | Source, OCI registry, CI |
| **Data** | Source code, container images, CI logs |
| **SOC 2** | N/A (self-hosted) |
| **Exit** | Migrar para GitLab. ~semanas |

### Bitwarden Secrets Manager (BWS)

| | |
|---|---|
| **Service** | Secret storage (project `iedora-deploy`) |
| **Data** | All secrets at rest (encrypted) |
| **SOC 2** | Type II — current |
| **Exit** | Migrar para 1password CLI / age-encrypted file. ~1 dia |

## Tier 2 — Infrastructure

### Hetzner

| | |
|---|---|
| **Service** | VPS (Beelink CAX11) — Docker host |
| **Data** | All prod data at rest (Postgres) |
| **ISO 27001** | Sim |
| **Exit** | `pg_dump` + restore noutro VPS. ~horas |

## Tier 3 — Code dependencies

| Dep | License | O que faz |
|-----|---------|-----------|
| better-auth | MIT | Auth in-process |
| Drizzle ORM | Apache 2.0 | DB queries + migrations |
| postgres-js | Unlicense | Postgres driver |
| Next.js | MIT | App framework |
| React | MIT | UI |
| Tailwind v4 | MIT | CSS |
| shadcn/ui | MIT | Componentes |
| @dnd-kit | MIT | Drag-and-drop |
| Kamal | MIT | Deploy tool |

## What we don't use

| Capability | What we don't use | Instead |
|-----------|------------------|---------|
| Identity | Auth0, Clerk | better-auth in-process |
| Observability | Datadog, Sentry | OpenObserve self-hosted |
| CI | CircleCI, Buildkite | Gitea Actions |
| Email | Resend, SendGrid | (none yet) |
