# CI

CI corre em **Gitea Actions** (não GitHub Actions). Workflow único em
`.gitea/workflows/ci.yml` — 3 jobs.

## Pipeline (`ci.yml`)

| Job | Triggers | O que faz |
|-----|----------|-----------|
| `ci` | PR + push main + dispatch | Typecheck + lint + test (todos os workspaces) |
| `audit` | PR + push main + dispatch + cron | gitleaks + hadolint + osv-scanner |
| `deploy` | push main + dispatch (`needs: [ci, audit]`) | `kamal deploy -d production` |

## Flow

1. **Pull request** → `ci` + `audit` correm em paralelo. `deploy` skip.
2. **Push a main** → `ci` + `audit` em paralelo; se ambos verdes,
   `deploy` corre `kamal deploy -d production`:
   - Build da imagem no remote builder (Beelink, amd64 nativo)
   - Push para Gitea OCI registry (`git.iedora.com/eduvhc/web`)
   - Pre-deploy hook corre migrations
   - Blue-green swap zero-downtime (só se healthcheck passar)
3. **Cron weekly** → só `audit` corre (refresca CVE database).

## Nota

O pipeline legado (Go + Tofu: `bin/iedora-env`, `bin/iedora`, `infra/`)
foi removido. Kamal + infra-bootstrap é o fluxo actual.
