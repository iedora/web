# iedora

Monorepo — one Next.js container serving three hostnames through
Host-based rewrites.

- **Menu** (`menu.iedora.com`) — SaaS multi-tenant restaurant menu builder.
- **Core** (`core.iedora.com`) — better-auth sign-in surface via `@iedora/auth`.
- **House** (`iedora.com`) — brand landing.

Identity is `@iedora/auth` (better-auth in-process). `docs/dev.md` for local
development. `docs/deploy/README.md` for the 4-stage pipeline.

## Quick start

```bash
bun install                 # once
./bin/dev-stack             # boots postgres, s3mock, openobserve, menu
cd apps/web && bun run dev  # HMR on :3000
```

## Ship it

```
bin/iedora-env tofu -chdir=infra/iac/tofu apply   # IaC
bin/iedora-env bin/iedora app apply               # migrations
bin/iedora-env bin/iedora deploy menu             # deploy
```

## Docs

- [AGENTS.md](AGENTS.md) — stack, rules, conventions, file layout
- [docs/dev.md](docs/dev.md) — local development
- [docs/deploy/README.md](docs/deploy/README.md) — infra + deploy
- [docs/vendors.md](docs/vendors.md) — dependency rationale
