# AI tooling

> What MCP servers Claude Code loads when you open a session in this
> repo. The Claude Code GitHub Action and its OAuth token were retired
> on 2026-05-26 — iedora is solo + Claude Code-local-only today.

## MCP servers (local Claude Code)

[`.mcp.json`](../.mcp.json) at the repo root is checked in, so every
contributor's Claude Code session loads the same servers. All are
`bunx`-launched except the remote GitHub one.

| Server | Transport | Purpose | Needs |
|---|---|---|---|
| `shadcn` | `bunx shadcn@latest mcp` | Pull shadcn/ui component sources (menu) | — |
| `postgres` | `bunx @modelcontextprotocol/server-postgres` | Read-only query of the local `menu` DB | local Postgres on `:5432` |
| `bun` | `bunx mcp-bun@latest` | Run Bun scripts/tests via MCP | — |
| `next-devtools` | `bunx next-devtools-mcp@latest` | Next.js 16 devtools introspection | — |
| `playwright` | `bunx @playwright/mcp@latest` | Drive a browser for E2E exploration | — |
| `github` | HTTP → `api.githubcopilot.com/mcp/` | Issues/PRs/repo over the GitHub MCP | `GITHUB_PERSONAL_ACCESS_TOKEN` env var |

Only the `github` server needs a credential: export
`GITHUB_PERSONAL_ACCESS_TOKEN` in your shell before launching Claude
Code (a classic or fine-grained PAT scoped to `eduvhc/iedora`). It is
read from the environment at MCP-connect time — it is **not** stored
in the repo.

## See also

- [`docs/deploy.md`](deploy.md) — every other credential (BWS /
  Tofu-managed). This doc owns only the local MCP wiring.
- [`AGENTS.md`](../AGENTS.md) — repo conventions Claude follows when
  invoked here.
