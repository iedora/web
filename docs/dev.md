# Dev local

## Quick start

```bash
bun install                     # uma vez
docker compose -f dev/docker-compose.yml --env-file dev/.env up -d   # postgres + s3mock
bun run dev:migrate             # criar schema nas DBs locais
cd apps/web && bun run dev      # HMR em :3000
```

Ou via atalhos:

```bash
bun run dev:up                  # docker compose up -d
bun run dev:migrate             # migrations
bun run dev                     # next dev
```

## Serviços

| Serviço | Container | Porta |
|---------|-----------|-------|
| postgres | infra-postgres | 5432 |
| s3mock | infra-s3mock | 9090 |

O `dev/docker-compose.yml` monta `config/postgres/init.sql` que cria
as databases `menu`, `core` e `imopush`.

## .env

O `apps/web/.env` é gitignored. As vars `NEXT_PUBLIC_*` sobrescrevem
para `localhost:3000`. Se precisas de apontar para serviços remotos,
cria `apps/web/.env.local`:

```ini
MENU_DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/menu
CORE_DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/core
```

## Comandos

```bash
bun run dev:up                  # Boot postgres + s3mock
bun run dev:down                # Stop
bun run dev:reset               # Apaga volumes (perde dados)
bun run dev:logs                # Logs
bun run dev:migrate             # Corre migrations
bun run typecheck               # TS check em todos os workspaces
bun run lint                    # ESLint em todos
bun run test                    # Vitest em todos
```

## Git & push

Setup canonical (SSH auto + commit signing + Conventional Commits) em
[git.md](git.md). Inclui instruções macOS/Linux **e Windows** (Git Bash
+ PowerShell).
