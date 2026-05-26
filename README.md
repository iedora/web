# iedora

Bun-workspaces monorepo with one Next.js product serving two hostnames,
plus three shared packages.

- **Menu** (`menu.iedora.com`) — SaaS for restaurants to build digital
  menus by drag-and-drop. Public menu at `/r/<slug>`; admin dashboard
  with reorderable categories, items, image uploads, themes,
  multi-language overrides, plans, analytics.
- **House** (`iedora.com`) — brand landing page. Lives in the same
  Next.js app at `src/app/house/`; `src/proxy.ts` inspects Host and
  rewrites apex requests internally. One image, one container, two
  hostnames.

Identity is Zitadel (`auth.iedora.com`, self-hosted). Menu is a thin
OIDC client — see `products/menu/src/features/auth/`.

## Run it locally

```bash
bun install                                  # at the repo root
go run ./dev/cmd/local-stack                 # boots postgres, localstack,
                                             # zitadel, openobserve
cd products/menu && bun run dev              # menu HMR (reads .env + .env.local)
```

## Ship it

```bash
# Stage 2 — IaC (Hetzner + Cloudflare + the compose stack)
bin/iedora-env tofu -chdir=infra/iac/tofu apply

# Stage 3 — app-state configurators (Zitadel, migrations, dashboards)
bin/iedora-env bin/iedora app apply

# Stage 4 — deploy a product
bin/iedora-env bin/iedora deploy menu
```

`bin/iedora-env` is the one-line env-hydration helper — it pulls every
BWS secret + exports the `TF_VAR_*` / `AWS_*` / `CLOUDFLARE_ACCOUNT_ID`
aliases everything downstream expects. Same pattern as `op run --` or
`doppler run --`. Required in your shell: `BWS_ACCESS_TOKEN`.

See [`docs/deploy.md`](docs/deploy.md) for the architecture, the
4-stage pipeline, and every operational runbook.

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
