# Runbook — dev

Deploy → ver [`runbook.deploy.md`](./runbook.deploy.md).

## Dev local

```bash
bun install
bun run dev:up           # postgres + s3mock
bun run dev:migrate      # schema nas 2 DBs (core, menu)
bun run dev              # next dev em :3000
```

Pasta `infra/dev/` só tem `docker-compose.yml` (Postgres + s3mock, ports `:5432`/`:9090`, buckets `iedora-data`/`iedora-assets` hardcoded).

App env vive em `apps/web/`:
- `.env` — defaults dev (DB URLs, S3, better-auth, `NEXT_PUBLIC_*`). Tracked, sem secrets. Next lê automaticamente; `dev:migrate` faz source pelo path.
- `.env.local` — secrets (AI keys, real S3 creds, overrides). Gitignored. Next hot-reloada quando muda.
- `.env.test` — E2E build env. Tracked.

Reset volumes: `bun run dev:reset`. Logs: `bun run dev:logs`.

## Comandos (root `package.json`)

| Comando | O que faz |
|---|---|
| `bun install` | Instala/refresca dependências de todos os workspaces (instala git hooks via `postinstall`). |
| `bun run dev` | `next dev` em `:3000` (Next lê `apps/web/.env` + `.env.local`). |
| `bun run dev:up` | Boot Postgres + s3mock (`docker compose up -d`). |
| `bun run dev:down` | Pára containers (mantém volumes). |
| `bun run dev:logs` | Tail dos logs do compose stack. |
| `bun run dev:reset` | Pára + apaga volumes (**perde dados locais**). |
| `bun run dev:migrate` | Aplica Drizzle migrations em sequência: `auth` → `menu`. |
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
| `bun run build:test` | Build de produção com env `.env.test` (para E2E). |
| `bun run test:e2e` | Playwright suite contra a build de teste. |
| `bun run test:e2e:ui` | Playwright em modo interactivo. |
| `bun run test:e2e:debug` | Playwright com `PWDEBUG=1`. |
| `bun run db:migrate:test` | Aplica migrations nas DBs `*_test` (chama `scripts/migrate-test.mjs`). |

## Comandos (`products/menu`, `packages/business/auth`)

| Comando | O que faz |
|---|---|
| `bun run db:generate` | Gera nova migration Drizzle a partir do schema (`drizzle-kit generate`). |
| `bun run db:migrate` | Aplica migrations pendentes contra a DB do produto. |
| `bun run db:studio` | Drizzle Studio (UI para inspeccionar a DB). |
| `bun run db:push` | (`menu` apenas) Push do schema directo, sem migration — só dev. |
