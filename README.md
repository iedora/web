# iedora

Bun-workspaces monorepo for two products and three shared packages.

- **Menu** (`menu.iedora.com` — `products/menu/`) — Next.js 16 SaaS for restaurants to build digital menus by drag-and-drop. Public menu at `/r/<slug>`; admin dashboard with reorderable categories, items, image uploads, themes, multi-language overrides, plans, analytics.
- **House** (`iedora.com` — `products/house/`) — Astro static umbrella landing. No DB, no auth.

Identity is Zitadel (`auth.iedora.com`, self-hosted). Menu is a thin OIDC client — see `products/menu/src/features/auth/`.

## Run it locally

```bash
bun install                            # at the repo root
task local                               # boots postgres, localstack,
                                       # zitadel, openobserve, house
                                       # (menu runs via bun run dev)
cd products/menu && bun run dev        # menu HMR (reads .env + .env.local)
```

`task --list-all` lists every recipe.

## Ship it

```bash
task up        # full pipeline: infra → app state → deploy products
```

See [`docs/deploy.md`](docs/deploy.md) for the architecture, the 4-stage
pipeline, and every operational runbook.

## Docs

- **[`AGENTS.md`](AGENTS.md)** — tech stack, hard rules, file layout, conventions (loaded by AI assistants too).
- **[`docs/deploy.md`](docs/deploy.md)** — **the** infra + app-state + deploy doc. Architecture, stages, commands, CI, failure modes, secret rotation, bootstrap, day-2 ops.
- **[`docs/architecture.md`](docs/architecture.md)** — vertical-slice + hexagonal playbook, how to add a feature.
- **[`docs/testing.md`](docs/testing.md)** — Vitest + PGLite unit tests, Playwright e2e.
- **[`docs/tenancy.md`](docs/tenancy.md)** — multi-tenant model + Zitadel org mapping.
- **[`docs/terraform-style.md`](docs/terraform-style.md)** — LLM-safe HCL conventions.
- **[`docs/security-audit.md`](docs/security-audit.md)** — threat register + supply-chain perimeter.
- **[`docs/vendors.md`](docs/vendors.md)** — every dependency with rationale.
- **[`docs/ai.md`](docs/ai.md)** — Claude Code Action + MCP servers.

## License

Not yet declared.
