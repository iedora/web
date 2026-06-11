# iedora

Monorepo — um backend Go (`services/`) + um container Next.js UI-only
que serve dois hostnames via host-based rewrites. Auth (sign-in/up/out)
vive dentro do menu (`menu.iedora.com/sign-in`).

- **Menu** (`menu.iedora.com`) — SaaS multi-tenant restaurant menu builder
- **House** (`iedora.com`) — brand landing
- **Admin** (`admin.iedora.com`) — staff console (Go templ+HTMX, `services/cmd/admin`)

Deploy: **iedora-infra** (Docker Swarm + Ansible + OpenTofu). Ver
[`docs/runbook.deploy.md`](docs/runbook.deploy.md).

## Quick start

```bash
bun install
bun run dev:up           # backend Go completo (Postgres + NATS + MinIO + serviços)
bun run dev              # Next.js HMR em :3000
```

## Docs

- [AGENTS.md](AGENTS.md) — stack, rules, conventions
- [services/README.md](services/README.md) — o backend Go
- [docs/runbook.dev.md](docs/runbook.dev.md) — dev local
- [docs/runbook.deploy.md](docs/runbook.deploy.md) — deploy + ops
