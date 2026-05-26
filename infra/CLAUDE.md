# `infra/` — every pipeline concern

The platform that runs `menu.iedora.com`, `iedora.com`, and `auth.iedora.com`. Four pipeline stages plus a local-stack mirror, all under one roof.

Products and workspace packages live elsewhere (`/products/`, `/packages/`); everything pipeline-shaped lives here.

## Layout

```
infra/
  iac/                     Stage 2 — IaC for the shared estate
    tofu/                    Single encrypted Tofu root: Hetzner + Cloudflare +
                             GitHub config + the rendered docker-compose stack
                             (postgres, zitadel, zitadel-login, caddy,
                             openobserve, backups). Per-product containers
                             (menu) are NOT here — they're owned by Stage 4.

                             Key files:
                               compose.tf         compose document (yamlencode)
                               sync.tf            day-2 SSH push of compose/Caddyfile
                               destroy-hooks.tf   rclone purge R2 buckets on destroy
                               hetzner.tf         VPS + cloud-init (first boot)
                               templates/         Caddyfile + cloud-init templates

    postgres/init.sql        CREATE DATABASE menu / zitadel on first boot.
    cmd/
      bws-upsert/            Tofu local-exec helper (idempotent BWS upsert).
      iedora-backup/         Backup container: daily encrypted pg_dumpall → R2.
                             Go binary + Dockerfile co-located.
      state-bucket-bootstrap/ Stage -1 — provisions the R2 bucket + scoped CF
                             token the Tofu s3 backend needs (chicken/egg).

  app-state/               Stage 3 — configurators (reconcile running services)
    cmd/
      zitadel-apply/         Zitadel REST reconciler (org / project / OIDC /
                             machine user + PAT / action targets / grants).
      menu-db-migrations/    drizzle-kit migrate against menu's postgres DB.
      openobserve-dashboards/ Push embedded JSON dashboards via SSH `-L` tunnel.

  deploy/                  Stage 4 + Stage-3 router
    cmd/
      iedora/                Subcommands: app apply, deploy <prod>, destroy
                             <prod>, doctor. Owns the configurator registry
                             (configurators.go) + the productRuntime registry
                             (products.go + runtime_*.go). NO `iac` subcommand
                             — Stage 2 is plain `tofu`.
```

`infra/` holds ONLY the three pipeline-stage folders (iac, app-state, deploy). The local-stack mirror (`dev/`) and shared Go libs (`internal/`) live at the repo root.

Repo-root siblings of `infra/`:

```
dev/                       Local stack — mirror of all 4 stages, against local Docker
  docker-compose.yml         Postgres + Zitadel + OpenObserve + LocalStack
  localstack-init.sh         Seeds LocalStack's R2 buckets on first boot
  cmd/local-stack/           Driver: compose up → zitadel-apply --mode local
                             → compose menu .env → start menu container.

internal/                  Shared Go libs (Go's `internal/` visibility scopes
                           them to the whole module — every stage's cmd imports
                           freely).
  bws/                       bws CLI wrapper
  cloudflare/                CF /accounts API + R2 S3 creds derivation
  mode/                      binary-mode enum (local vs live; Guardrail #1)
  r2/                        pure-Go SigV4 S3 client (used by iedora-backup)
  ssh/                       Client (shared by iedora + Stage 3 configurators)
  tlsprobe/                  /debug/ready + LE-cert probe for Zitadel readiness
  testfakes/                 HTTP server fakes for unit tests
```

Operators always invoke via shims at the repo root (`bin/<name>`); those shims `go run` the Go cmd packages under `infra/<stage>/cmd/<name>/`. Operators never `cd` into `infra/`.

## Hard rules

1. **Declarative-first.** Every cloud resource is Tofu-managed under `infra/iac/tofu/`. **Edit `.tf` files, never the upstream UI** — `tofu apply` silently clobbers UI edits.
2. **Tofu-managed credentials write through to BWS** as `IAC_*` (`iac/tofu/secrets.tf::terraform_data.bws_sync_autogen` → `bin/bws-upsert`). Editing BWS directly is wasted work; the next apply restores Tofu's value.
3. **Bootstrap order is BWS → Tofu → write-through.** Operator pastes the `IAC_BOOTSTRAP_*` keys first; everything else is Tofu-minted.
4. **Follow [`docs/terraform-style.md`](../docs/terraform-style.md)** when editing any `.tf` — pessimistic `~>` pins, `for_each` over `count`, `validation` blocks.
5. **State lives in Cloudflare R2** via the OpenTofu `s3` backend. Bootstrap helper at [`iac/cmd/state-bucket-bootstrap/`](iac/cmd/state-bucket-bootstrap/).
6. **The box owns its containers — Tofu only renders the compose.** Adding/editing a service = edit `iac/tofu/compose.tf`. Tofu renders the YAML; `terraform_data.iedora_sync` SCPs it to the box and `systemctl restart iedora.service` reconciles. **No `docker_*` Tofu resources** — the kreuzwerker provider is intentionally gone (it forced multi-pass applies, MaxStartups workarounds, and state-rm dances on destroy).
7. **Run the pre-merge runbook on every deploy-shape change** — see [`docs/deploy.md`](../docs/deploy.md) § Pre-merge runbook.

## Adding things

- **New shared container** → new service entry in `infra/iac/tofu/compose.tf` (under `local.compose.services`). cloud-init drops the new compose on first boot; `terraform_data.iedora_sync` ships it on day-2.
- **New Stage 3 configurator** → new `infra/app-state/cmd/<name>/` (`package main`) + new shim `bin/<name>` + entry in `infra/deploy/cmd/iedora/configurators.go`.
- **New product** → new `productRuntime` struct in `infra/deploy/cmd/iedora/products.go` + new GitHub Actions caller workflow that invokes `deploy.yml` with `inputs.product=<name>`.
- **New Tofu helper called from `local-exec`** → new `infra/iac/cmd/<name>/` + shim at `bin/<name>` + `path.module/../../../bin/<name>` from the Tofu file.

## Commands

No task runner. Operators invoke `tofu` and `bin/iedora` directly under `bws run`:

```
bws run -- bin/iedora doctor                                  # preflight
bws run -- tofu -chdir=infra/iac/tofu init                    # Stage 2 prereq
bws run -- tofu -chdir=infra/iac/tofu plan                    # Stage 2 dry-run
bws run -- tofu -chdir=infra/iac/tofu apply                   # Stage 2 apply
bws run -- tofu -chdir=infra/iac/tofu destroy                 # Stage 2 teardown
bws run -- bin/iedora app apply                               # Stage 3
bws run -- bin/iedora deploy menu                             # Stage 4 (menu)
bws run -- bin/iedora deploy house                            # Stage 4 (house)
go run ./dev/cmd/local-stack                                  # Local dev stack
```

`bws` is the only env-injection layer — it hydrates every BWS secret into the child process's env. Stage filtering was dropped (the old `with-secrets` wrapper); BWS leakage between stages is an accepted trade for simplicity.

For day-2 raw-SSH ops (logs, psql, backup, restore, rotation, Zitadel rebootstrap), see [`docs/deploy.md` § Day-2 operations](../docs/deploy.md#day-2-operations).
