# iedora

Monorepo — um container Next.js que serve três hostnames via
host-based rewrites.

- **Menu** (`menu.iedora.com`) — SaaS multi-tenant restaurant menu builder
- **Core** (`core.iedora.com`) — better-auth sign-in via `@iedora/auth`
- **House** (`iedora.com`) — brand landing

Deploy: **Kamal** + **`home-infra/`**. Ver `home-infra/README.md` e `docs/deploy/`.

## Quick start

```bash
bun install
bun run dev:up           # postgres + s3mock (Docker)
bun run dev:migrate      # schema nas DBs locais
bun run dev              # Next.js HMR em :3000
```

## Ship it

```bash
kamal setup -d production          # primeira vez
kamal deploy -d production         # deploys seguintes
```

## Docs

- [AGENTS.md](AGENTS.md) — stack, rules, conventions
- [docs/dev.md](docs/dev.md) — dev local
- [docs/deploy/README.md](docs/deploy/README.md) — infra + deploy
