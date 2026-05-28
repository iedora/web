# Tech debt

## Deploy pipeline legada (Go + Tofu)

A pipeline Go (`bin/iedora-env`, `bin/iedora`, `infra/`, `internal/`,
`go.mod`) foi removida a favor de Kamal + infra-bootstrap. Os workflows
CI ainda referenciam a pipeline legada — precisam de ser migrados.

### TODO: Migrar CI para Kamal

- `web.yml` / `deploy.yml` — em vez de `bin/iedora-env bin/iedora deploy web`,
  correr `kamal deploy -d production`
- `infra-deploy.yml` — remover (infra é Kamal accessories + infra-bootstrap)
- `app-state.yml` — migrations correm em boot do container ou via
  `ssh docker exec`
- `.github/` foi removido — workflows migrados para `.gitea/workflows/`

### Outros

- Kamal usa builder remoto SSH para build — lento para dev. Ideal:
  build local + push + `kamal deploy`
- `infra-bootstrap/` são scripts bash — sem testes, sem idempotência
  garantida
- `docs/deploy/*` referenciam `bin/dev-stack` que foi removido
