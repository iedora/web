# Shared infra — `infra/`

> The canonical infra + deploy reference is
> [**`docs/deploy.md`**](../docs/deploy.md). Read it first — it covers
> the pipeline, every stage, failure modes, secret rotation,
> bootstrap, day-2 ops, and the local dev stack.
>
> The non-negotiable rules are
> [**`docs/deploy.md` § Environment guardrails**](../docs/deploy.md#environment-guardrails).
> Open work to bring code in line with them lives in
> [**`docs/guardrails-implementation.md`**](../docs/guardrails-implementation.md).
>
> When editing `.tf` files, follow
> [**`docs/terraform-style.md`**](../docs/terraform-style.md).

## What's in this directory

```
infra/
  tofu/                  Single Tofu root: Hetzner + Cloudflare + GitHub
                         config + shared service containers
                         (postgres, openobserve, zitadel, zitadel-login,
                         caddy, backups). Per-product containers (menu)
                         are NOT here — they're owned by Stage 4.
  cmd/iedora/            Stage 2/3/4 orchestrator (live).
                         Subcommands: iac, app, deploy, destroy,
                         pipeline, doctor.
  cmd/local/             Local-stack orchestrator (`task local`).
                         Thin shim over `docker compose` against
                         infra/local/docker-compose.yml.
  local/                 docker-compose.yml + localstack init script
                         + (gitignored) .zitadel-bootstrap/.
  cmd/zitadel-apply/     Stage 3 — reconciles Zitadel app state
                         (org, project, OIDC app, machine user + PAT,
                         action targets, admin grants).
  cmd/menu-db-migrations/ Stage 3 — drizzle-kit migrate against menu's
                         postgres database.
  cmd/openobserve-dashboards/ Stage 3 — pushes embedded JSON dashboards
                         via SSH `-L` tunnel.
  cmd/with-secrets/      BWS env wrapper. Stage-filtered (iac / app /
                         deploy + per-product).
  cmd/bws-upsert/        Idempotent BWS list-then-edit-or-create helper.
                         Used by Tofu's `terraform_data.bws_sync_*`.
  modules/services/      Tofu modules — one per shared container type.
  internal/              Go helpers: bws, cloudflare, r2, tlsprobe.
  bin/                   `go run` wrappers the Taskfile shells through.
  cmd/iedora-backup/     Daily encrypted pg_dumpall → R2 backup binary
                         (replaces the prior infra/backup/*.sh scripts).
                         Includes its own Dockerfile.
  postgres/              `init.sql` — bootstrap databases on first boot.
```

## Operator entry points

The [root Taskfile](../Taskfile.yml) is the only entry point operators
should need:

```
task doctor           # preflight: BWS auth, bootstrap secrets, PATH
task infra:up         # Stage 2: tofu apply on infra/tofu/
task app:apply        # Stage 3: every configurator
task deploy:menu      # Stage 4: docker pull + run on the box
task deploy:house     # Stage 4: bun build + per-product tofu apply
task up               # Full pipeline: 2 → 3 → 4
task down             # Full teardown: products → infra:down
task local              # Local dev stack
```

For day-2 raw-SSH ops (logs, psql, backup, restore, rotation, Zitadel
rebootstrap), see [`docs/deploy.md` § Day-2 operations](../docs/deploy.md#day-2-operations).
