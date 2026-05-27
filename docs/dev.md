# Local development

Everything you need to run the full stack on your machine.

## Quick start

```bash
bun install                  # once
./bin/dev-stack              # boots postgres, s3mock, o2,
                             # menu + auth migrations + .env
cd apps/web && bun run dev   # HMR on :3000
```

## Flags

| Flag | What it does |
|---|---|
| _(none)_ | Boots everything: postgres, s3mock, openobserve, menu |
| `--only svc,...` | Start only these services + their dependencies |
| `--except svc,...` | Start everything except these |
| `--destroy` | Tear down: `docker compose down -v`. `.env.local` is preserved. |
| `--reset-db name` | Drop + recreate one database (`menu` or `core`) |
| `--help` | Show usage |

Services: `postgres`, `s3mock`, `openobserve`, `menu`.

## What it runs

[`bin/dev-stack`](../bin/dev-stack) is a thin bash shim (279 lines, `shellcheck`-clean) that:

1. Translates `--only`/`--except` into compose profile flags.
2. `docker compose up -d --wait` for infra services (everything except menu).
3. `bun run --cwd packages/auth db:migrate` against the local `core` database.
4. Composes `apps/web/.env` from local defaults.
5. `docker compose up -d menu` (optional — skip with `--except menu` for HMR).

## Services

[`dev/docker-compose.yml`](../dev/docker-compose.yml) is the source of truth:

| Service | Container | Port | Notes |
|---|---|---|---|
| postgres | `infra-postgres` | 5432 | `init.sql` creates `menu` + `core` databases |
| s3mock | `infra-s3mock` | 9090 | `adobe/s3mock` — buckets `iedora-data` + `iedora-assets` created on startup |
| openobserve | `infra-openobserve` | 5080 | Uses s3mock as S3 backend; login `dev@iedora.local` / `Password1!` |
| menu | `infra-menu` | 3000 | Next.js standalone, same Dockerfile as prod |

## Environment files

Two files under `apps/web/`, both gitignored.

### `.env` — auto-generated

Written fresh by `bin/dev-stack` on every run. Contains local stack defaults:

```
DATABASE_URL=postgres://postgres:Password1!@infra-postgres:5432/menu
S3_ENDPOINT=http://infra-s3mock:9090
S3_FORCE_PATH_STYLE=true
...
```

The menu container reads it via `env_file:` in docker-compose. `bun run dev` also reads it.

> **Do not edit `.env`** — it will be overwritten next time you run `bin/dev-stack`.

### `.env.local` — your overrides

Created manually by you. Higher precedence than `.env`. The orchestrator only READS it (pulls `IEDORA_CORE_SECRET` to keep sessions alive) — never writes to it.

Three use cases:

**1. Session persistence.** Without `.env.local`, every `bin/dev-stack` run mints a fresh `IEDORA_CORE_SECRET` and all sign-in sessions are invalidated. Copy the secret from `.env` into `.env.local` once and sessions survive restarts.

```bash
# After first run:
grep IEDORA_CORE_SECRET apps/web/.env >> apps/web/.env.local
```

**2. Remote services.** Override any key to point at real infrastructure:

```ini
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=my-real-bucket
DATABASE_URL=postgresql://user:pass@some-host:5432/menu
```

**3. HMR database URLs.** `.env` uses Docker network hostnames (`infra-postgres`, `infra-s3mock`). `bun run dev` runs outside Docker, on your host. Override:

```ini
DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/menu
CORE_DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/core
```

**Lifecycle:**

```
First run:   bin/dev-stack → mints secret → writes .env → you sign in
             you copy IEDORA_CORE_SECRET=… into .env.local

Warm runs:   bin/dev-stack → reads secret from .env.local → writes .env
             sessions survive ✓

Overrides:   you add S3_ENDPOINT=… to .env.local
             at runtime, .env.local takes precedence over .env ✓

Destroy:     bin/dev-stack --destroy → removes containers + volumes
             .env.local survives ✓
```

## HMR (hot reload)

By default, menu runs as a container (same image as prod). For HMR:

```bash
./bin/dev-stack --except menu    # boot infra only
cd apps/web && bun run dev       # HMR on :3000
```

The orchestrator still boots the infra services and runs core migrations — `bun run dev` Just Works.

Add this to `.env.local` so HMR can reach postgres:

```ini
DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/menu
CORE_DATABASE_URL=postgresql://postgres:Password1!@localhost:5432/core
```

## Running from anywhere

The script resolves paths relative to its own location, like every other `bin/` helper in this repo. You can invoke it from any directory:

```bash
./bin/dev-stack                   # from repo root
../bin/dev-stack                  # from apps/web/
~/code/iedora/bin/dev-stack       # absolute path
```
