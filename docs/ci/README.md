# CI

CI corre em **Gitea Actions** (não GitHub Actions). Workflows em
`.gitea/workflows/`.

## Workflows

| Workflow | Ficheiro | O que faz |
|----------|----------|-----------|
| `CI` | `.gitea/workflows/ci.yml` | Typecheck + lint + test (todos os workspaces num job) |
| `Deploy` | `.gitea/workflows/deploy.yml` | `kamal deploy` para produção (build remoto + blue-green) |

## CI flow

1. **Pull request / push a main** → `ci.yml` corre typecheck + lint + test.
2. **Push a main** → `deploy.yml` corre `kamal deploy -d production`:
   - Build da imagem no remote builder (Beelink, amd64 nativo)
   - Push para Gitea OCI registry (`git.iedora.com/eduvhc/web`)
   - Pre-deploy hook corre migrations
   - Blue-green swap zero-downtime

## Nota

O pipeline legado (Go + Tofu: `bin/iedora-env`, `bin/iedora`, `infra/`)
foi removido. Kamal + infra-bootstrap é o fluxo actual.
