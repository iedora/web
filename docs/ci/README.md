# CI

CI corre em **Gitea Actions** (não GitHub Actions). Workflow único em
`.gitea/workflows/ci.yml` — 3 jobs.

## Pipeline (`ci.yml`)

| Job | Triggers | O que faz |
|-----|----------|-----------|
| `ci` | PR + push main + dispatch | Typecheck + lint + test (todos os workspaces) |
| `audit` | PR + push main + dispatch + cron | gitleaks + hadolint + osv-scanner |
| `deploy` | push main + dispatch (`needs: [ci, audit]`) | rsync + ssh trigger Kamal no Beelink |

## Flow

1. **Pull request** → `ci` + `audit` correm em paralelo. `deploy` skip.
2. **Push a main** → `ci` + `audit` em paralelo; se ambos verdes,
   `deploy` faz `rsync` da source para `/opt/iedora` no Beelink e
   `ssh root@beelink kamal deploy -d production`:
   - Build local (docker driver, Beelink amd64 nativo)
   - Push para `192.168.50.53:3030/eduvhc/web` (localhost-to-localhost)
   - Pre-deploy hook corre migrations
   - Blue-green swap zero-downtime (só se healthcheck passar)
3. **Cron weekly** → só `audit` corre (refresca CVE database).

**Porquê SSH trigger em vez de Kamal no runner?** O gitea-runner corre
no próprio Beelink. Spawnar buildkit container remoto (do mesmo host
que corre o runner) para fazer push para um registry no mesmo host era
absurdo arquiteturalmente — e prático, porque o buildkit ignora o
`insecure-registries` do daemon ([basecamp/kamal#937](https://github.com/basecamp/kamal/issues/937)).
Correr Kamal directamente no Beelink usa o default `docker` driver
que respeita o daemon → push localhost simples, sem TLS hacks.

## Nota

O pipeline legado (Go + Tofu: `bin/iedora-env`, `bin/iedora`, `infra/`)
foi removido. Kamal + `home-infra/` é o fluxo actual.
