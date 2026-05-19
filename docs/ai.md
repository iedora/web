# AI tooling

> One-line purpose: how the AI-assisted surfaces of this repo are wired
> — the Claude Code GitHub Action, its auth, and the MCP servers Claude
> Code loads locally.
> **Last reviewed:** 2026-05-19 — initial: Claude Code Action +
> CLAUDE_CODE_OAUTH_TOKEN setup + `.mcp.json` inventory.

## Repo-slug gotcha (read this first)

The repo was renamed on GitHub. The canonical slug is **`eduvhc/iedora`**.

- The local working directory is still `meta-menu/` and `git remote -v`
  still prints `…/meta-menu.git` — GitHub redirects the old URL, so git
  keeps working and nobody bothered to repoint the remote.
- `gh` resolves the redirect: `gh repo view --json nameWithOwner` →
  `eduvhc/iedora`.

**Every `gh` command in this doc uses `--repo eduvhc/iedora` explicitly.**
Do not infer the slug from the folder name or the git remote.

## Claude Code GitHub Action

Workflow: [`.github/workflows/claude.yml`](../.github/workflows/claude.yml).
Marketplace action: `anthropics/claude-code-action@v1` (SHA-pinned per
repo convention).

**Triggers** (no `paths:` filter — it's conversation-triggered, not
code-triggered; the action no-ops when no `@claude`/assignment is
present):

| Event | What fires it |
|---|---|
| `issue_comment` / `pull_request_review_comment` | A comment containing `@claude` |
| `issues` (`opened`, `assigned`, `labeled`) | `@claude` in the body, or **assigning the issue to `claude`** |
| `pull_request_review` (`submitted`) | `@claude` in a review |

Two entry points, with one asymmetry:

- **Mention** — comment `@claude` in any issue or PR thread (or PR
  review). Works everywhere.
- **Assign** — assigning an **issue** to `claude` triggers it, but
  only because the workflow sets `assignee_trigger: claude` (the input
  has no default; without it `issues: [assigned]` fires the workflow
  yet the action no-ops). Per the action docs `assignee_trigger` is
  **issue-assignment-only** — **assigning a pull request does not
  activate Claude**. Comment `@claude` on the PR instead.

**Permissions** granted to the job (least-privilege): `contents: write`
(branch/push), `pull-requests: write` + `issues: write` (comment back),
`id-token: write` (OIDC exchange), `actions: read` (inspect its own run
logs when asked to debug CI).

> Security note: anyone who can comment `@claude` on this repo can
> trigger code-writing runs against the subscription token. Acceptable
> for a solo / AI-driven private repo (consistent with branch protection
> being deliberately off — see `scorecard.yml`). Revisit when adding
> collaborators.

### Auth — CLAUDE_CODE_OAUTH_TOKEN

The action authenticates with a Pro/Max **OAuth token**, not an
Anthropic API key. It is a manually-set GitHub Actions secret —
**not** in BWS and **not** Tofu-managed (it's tied to a personal
subscription login, so it can't be a Tofu write-through; this is the
documented exception to `docs/secrets.md` "GitHub Actions
secrets/variables are Tofu-managed").

One-time setup (repo admin):

1. **Install the Claude GitHub app:** https://github.com/apps/claude —
   grant it this repo.
2. **Mint the token** locally (interactive; opens a browser for the
   Pro/Max login). In a Claude Code session you can run it inline:

   ```
   ! claude setup-token
   ```

   It prints a token starting with `sk-ant-oat…`.
3. **Store it as a repo secret** via `gh`. Never pass the token as a
   CLI argument (shell history / process list leak). Either pipe it:

   ```powershell
   "sk-ant-oat…" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo eduvhc/iedora
   ```

   …or let `gh` prompt for it hidden (value never touches the command
   line):

   ```powershell
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo eduvhc/iedora
   ```

4. **Verify** (prints name + update time, never the value):

   ```powershell
   gh secret list --repo eduvhc/iedora
   ```

This is a default-scope **Actions** secret — exactly what
`${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` in the workflow reads. No
`--app` flag.

### Rotation / revocation

- **Rotate:** re-run `claude setup-token`, repeat step 3 (overwrites).
- **Revoke:** delete it — `gh secret delete CLAUDE_CODE_OAUTH_TOKEN
  --repo eduvhc/iedora` — and/or revoke the OAuth grant in your
  Anthropic account. The workflow then fails closed (auth error), it
  does not run unauthenticated.
- No expiry discipline entry in `docs/secrets.md` because it's not a
  BWS/Tofu credential; treat its lifecycle as "rotate on suspicion,
  revoke when the Action is removed".

## MCP servers (local Claude Code)

`.mcp.json` (repo root) is checked in, so every contributor's Claude
Code session loads the same servers. All are `bunx`-launched except the
remote GitHub one.

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
read from the environment at MCP-connect time — it is **not** stored in
the repo and is unrelated to the Action's `CLAUDE_CODE_OAUTH_TOKEN`.

## See also

- `docs/secrets.md` — every other credential (BWS / Tofu-managed). This
  doc owns only the two AI-specific, non-BWS credentials above.
- `AGENTS.md` — repo conventions Claude follows when invoked here.
