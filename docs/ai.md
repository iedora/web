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
Anthropic API key. It is BWS-managed and Tofu-written-through, the same
shape as every other GitHub Actions secret in this repo (`docs/deploy.md`
§ Tofu-managed write-throughs). Only *minting* the token is interactive
(`claude setup-token`); *storing* it is a static string, so it fits the
write-through pattern with no exception.

The chain: `IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN` in BWS (`iedora-deploy`
project) → `infra/bin/with-secrets` exports `TF_VAR_claude_code_oauth_token`
→ `variable "claude_code_oauth_token"` (`infra/tofu/variables.tf`) →
`local.github_secrets["CLAUDE_CODE_OAUTH_TOKEN"]` (`infra/tofu/github.tf`)
→ `task up` reconciles the GitHub Actions secret the workflow
reads as `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

One-time setup:

1. **Install the Claude GitHub app:** https://github.com/apps/claude —
   grant it this repo (repo admin).
2. **Mint the token** locally (interactive; opens a browser for the
   Pro/Max login). In a Claude Code session you can run it inline:

   ```
   ! claude setup-token
   ```

   It prints a token starting with `sk-ant-oat…`.
3. **Put it in BWS** as `IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN` in the
   `iedora-deploy` project (`bws secret create`, or the Bitwarden UI).
   The value never goes near the GitHub UI or shell history.
4. **Write it through:** `task up`. Tofu reconciles the
   `CLAUDE_CODE_OAUTH_TOKEN` GitHub Actions secret from BWS,
   *overwriting* any value already there — so a previously hand-set
   `gh secret set` value is cleanly superseded on the first apply (no
   `gh secret delete` needed; the secret name is the same).

Do not edit the GitHub secret in the UI or with `gh secret set` once
it's Tofu-managed — the next `task up` silently clobbers it
(infra hard rule 1). Change the value in BWS instead.

### Rotation / revocation

- **Rotate:** re-run `claude setup-token`, update
  `IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN` in BWS, `task up`. Same
  recipe as every other write-through (or `bws secret edit <id>` directly).
- **Revoke:** revoke the OAuth grant in your Anthropic account and
  remove the BWS key + the `github.tf` map entry, then
  `task up`. The workflow then fails closed (auth error) —
  it does not run unauthenticated.
- Treat its lifecycle as "rotate on suspicion, revoke when the Action
  is removed" — see `docs/deploy.md` § Expiration discipline.

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

- `docs/deploy.md` — every other credential (BWS / Tofu-managed). This
  doc owns only the two AI-specific, non-BWS credentials above.
- `AGENTS.md` — repo conventions Claude follows when invoked here.
