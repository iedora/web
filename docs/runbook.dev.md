# Runbook — dev

Deploy → ver [`runbook.deploy.md`](./runbook.deploy.md).

## Dev local

```bash
bun install
bun run dev:up           # Go backend completo (services/docker-compose.yml)
bun run dev              # next dev em :3000
```

`bun run dev:up` levanta o backend inteiro a partir de
`services/docker-compose.yml`: os serviços Go (auth `:8080`, audit `:8081`,
admin `:8082`, billing `:8083`, menu `:8084`), Postgres (`:55432`), NATS,
MinIO (`:9000`) e OpenObserve (`:5080`). As migrations correm como one-shots
dentro do compose — não há passo de migração no lado TypeScript.

App env vive em `apps/web/`:
- `.env` — defaults dev (`AUTH_URL`/`MENU_URL` + `NEXT_PUBLIC_*`). Tracked, sem secrets. Next lê automaticamente.
- `.env.local` — overrides locais. Gitignored.

Reset volumes: `bun run dev:reset`. Logs: `bun run dev:logs`.

## Comandos (root `package.json`)

| Comando | O que faz |
|---|---|
| `bun install` | Instala/refresca dependências de todos os workspaces (instala git hooks via `postinstall`). |
| `bun run dev` | `next dev` em `:3000` (Next lê `apps/web/.env` + `.env.local`). |
| `bun run dev:up` | Boot do backend Go completo (`docker compose -f services/docker-compose.yml up -d --build`). |
| `bun run dev:down` | Pára containers (mantém volumes). |
| `bun run dev:logs` | Tail dos logs do compose stack. |
| `bun run dev:reset` | Pára + apaga volumes (**perde dados locais**). |
| `bun run typecheck` | TS check paralelo em todos os workspaces. |
| `bun run lint` | ESLint paralelo em todos os workspaces. |
| `bun run test` | Vitest em todos os workspaces. |

## Comandos (`apps/web`)

| Comando | O que faz |
|---|---|
| `bun run dev` | `next dev` (Turbopack). Normalmente chamado via root `bun run dev`. |
| `bun run build` | `next build` (standalone output para o Dockerfile). |
| `bun run start` | `next start` no output standalone. |
| `bun run typecheck` | `tsgo --build`. |
| `bun run lint` | ESLint com cache. |

## Comandos (`services/` — backend Go)

| Comando | O que faz |
|---|---|
| `make test` | Unit tests (sem Docker). |
| `make test-integration` | Integration tests (testcontainers: Postgres real). |
| `make test-all` | Ambos. |
| `make vet` / `make fmt` | Vet + format. |

Schema changes: cada serviço Go é dono das suas migrations
(`services/migrations/<svc>/`); aplica-as com o one-shot `<svc> migrate`
(o compose já o faz no arranque).
