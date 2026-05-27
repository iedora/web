# `infra/` — every pipeline concern

The platform that runs `menu.iedora.com` and `iedora.com`. Four pipeline stages plus a dev-stack mirror, all under one roof.

Products and workspace packages live elsewhere (`/products/`, `/packages/`); everything pipeline-shaped lives here.

## Layout

```
infra/
  iac/                     Stage 2 — IaC for the shared estate
    tofu/                    Single encrypted Tofu root: Hetzner + Cloudflare +
                             GitHub config + the rendered docker-compose stack
                             (postgres, cloudflared, openobserve, backups).
                             Per-product containers (menu) are NOT here —
                             they're owned by Stage 4.

                             Key files:
                               compose.tf         compose document (yamlencode)
                               tunnel.tf          CF Tunnel config + ingress rules
                               sync.tf            day-2 SSH push of compose
                               destroy-hooks.tf   rclone purge R2 buckets on destroy
                               hetzner.tf         VPS + cloud-init (first boot)
                               templates/         cloud-init + systemd templates

    postgres/init.sql        CREATE DATABASE menu / core on first boot.
    cmd/
      bws-sync/              Batched BWS write/delete (Tofu local-exec entry
                             point). One sequential pass — sidesteps BWS's
                             ~1/s mutating-call rate limit.
      infra-pg-backup/         Backup container: daily encrypted pg_dumpall → R2.
                             arm64-only image (CAX boxes are arm64); Go binary
                             + Dockerfile co-located.
      state-bucket-bootstrap/ Stage -1 — provisions the R2 bucket + scoped CF
                             token the Tofu s3 backend needs (chicken/egg).

   app-state/               Stage 3 — configurators (reconcile running services)
    core-db-migrations/      drizzle-kit migrate against the `core` DB
                             (better-auth schema; runs first so the menu
                             container boots against a migrated `core.session`).
    menu-db-migrations/      drizzle-kit migrate against the `menu` DB.
    openobserve-dashboards/  Push embedded JSON dashboards via SSH `-L` tunnel.

  deploy/                  Stage 4 + Stage-3 router
    cmd/
      iedora/                Subcommands: app apply, deploy <prod>, destroy
                             <prod>, doctor. Owns the configurator registry
                             (configurators.go) + the productRuntime registry
                             (products.go + runtime_*.go). NO `iac` subcommand
                             — Stage 2 is plain `tofu`.
```

`infra/` holds ONLY the three pipeline-stage folders (iac, app-state, deploy). The dev-stack mirror (`dev/`) and shared Go libs (`internal/`) live at the repo root.

Repo-root siblings of `infra/`:

```
dev/                       Local stack — mirror of all 4 stages, against local Docker
  docker-compose.yml         Postgres + OpenObserve + adobe/s3mock

internal/                  Shared Go libs (Go's `internal/` visibility scopes
                           them to the whole module — every stage's cmd imports
                           freely).
  bws/                       bws CLI wrapper
  cloudflare/                CF /accounts API + R2 S3 creds derivation
  mode/                      binary-mode enum (local vs live; Guardrail #1)
  r2/                        pure-Go SigV4 S3 client (used by infra-pg-backup)
  ssh/                       Client (shared by iedora + Stage 3 configurators)
  tlsprobe/                  /debug/ready + CF-edge cert probe for service readiness
  testfakes/                 HTTP server fakes for unit tests
```

Operators always invoke via shims at the repo root (`bin/<name>`); those shims `go run` the Go cmd packages under `infra/<stage>/cmd/<name>/`. Operators never `cd` into `infra/`.

## Hard rules

1. **Declarative-first.** Every cloud resource is Tofu-managed under `infra/iac/tofu/`. **Edit `.tf` files, never the upstream UI** — `tofu apply` silently clobbers UI edits.
2. **Tofu-managed credentials write through to BWS** as `IAC_*` (`iac/tofu/secrets.tf::terraform_data.bws_sync` → `bin/bws-sync`). Editing BWS directly is wasted work; the next apply restores Tofu's value. On `tofu destroy`, the same wrapper deletes them.
3. **Bootstrap order is BWS → Tofu → write-through.** Operator pastes the `IAC_BOOTSTRAP_*` keys first; everything else is Tofu-minted.
4. **HCL conventions** (see § HCL style below) — pessimistic `~>` pins, `for_each` over `count`, `validation` blocks on every input, `removed {}` over `tofu state rm`.
5. **State lives in Cloudflare R2** via the OpenTofu `s3` backend. Bootstrap helper at [`iac/cmd/state-bucket-bootstrap/`](iac/cmd/state-bucket-bootstrap/).
6. **The box owns its containers — Tofu only renders the compose.** Adding/editing a service = edit `iac/tofu/compose.tf`. Tofu renders the YAML; `terraform_data.iedora_sync` SCPs it to the box and `systemctl restart iedora.service` reconciles. **No `docker_*` Tofu resources** — the kreuzwerker provider is intentionally gone (it forced multi-pass applies, MaxStartups workarounds, and state-rm dances on destroy).
7. **Run the pre-merge runbook on every deploy-shape change** — see [`docs/deploy/README.md`](../docs/deploy/README.md) § Pre-merge runbook.

## Adding things

- **New shared container** → new service entry in `infra/iac/tofu/compose.tf` (under `local.compose.services`). cloud-init drops the new compose on first boot; `terraform_data.iedora_sync` ships it on day-2.
- **New Stage 3 configurator** → new library package `infra/app-state/<name>/` exporting `Run(ctx) error` + entry in `infra/deploy/cmd/iedora/configurators.go`. Add a `cmd/` shim + `bin/<name>` wrapper only if standalone invocation is needed.
- **New product** → new `product` struct literal in `infra/deploy/cmd/iedora/products.go` (implementing the `productRuntime` interface) + new GitHub Actions caller workflow that invokes `deploy.yml` with `inputs.product=<name>`.
- **New Tofu helper called from `local-exec`** → new `infra/iac/cmd/<name>/` + shim at `bin/<name>` + `path.module/../../../bin/<name>` from the Tofu file.

## Commands

No task runner. Operators invoke `tofu` and `bin/iedora` through `bin/iedora-env`, which hydrates BWS secrets + the TF_VAR/AWS_*/CLOUDFLARE_ACCOUNT_ID env every consumer expects:

```
bin/iedora-env bin/iedora doctor                                  # preflight
bin/iedora-env tofu -chdir=infra/iac/tofu init                    # Stage 2 prereq
bin/iedora-env tofu -chdir=infra/iac/tofu plan                    # Stage 2 dry-run
bin/iedora-env tofu -chdir=infra/iac/tofu apply                   # Stage 2 apply
bin/iedora-env tofu -chdir=infra/iac/tofu destroy                 # Stage 2 teardown
bin/iedora-env bin/iedora app apply                               # Stage 3
bin/iedora-env bin/iedora deploy menu                             # Stage 4 (menu)
./bin/dev-stack                                              # Local dev stack
```

`bin/iedora-env` is the env-injection layer — a ~50-line shell helper that runs `bws secret list -o env`, derives `CLOUDFLARE_ACCOUNT_ID` via the CF API, and exports the `TF_VAR_*`/`AWS_*` aliases Tofu's backend + variables expect. Same shape as `op run --` (1Password) or `doppler run --`. Stage filtering was dropped (the old `with-secrets` wrapper); every consumer sees every BWS key.

**Required in your shell**: `BWS_ACCESS_TOKEN` (one-time setup, keep in keychain / direnv).

For day-2 raw-SSH ops (logs, psql, backup, restore, rotation), see [`docs/deploy/README.md` § Day-2 operations](../docs/deploy/README.md#day-2-operations).

## HCL style — LLM-safe conventions

LLMs produce HCL that parses far more often than HCL that applies. Apply these to every `.tf` in `infra/iac/tofu/`.

1. **Pessimistic version pins.** `~> X.Y` for every provider. Never `>=`, never unbounded.
2. **`for_each` over `count`.** `count` shifts addresses when an element is removed; `for_each` keyed on a set/map keeps them stable. For zero-or-one gates use `lifecycle { enabled = expr }` (OpenTofu 1.11+) — the resource lives at its canonical address (no `[0]` index) when enabled, has zero instances when not.
3. **Every input variable has a `validation` block.** Cheapest pre-`apply` gate. Pair with `nullable = false` when required.
4. **`locals` blocks are short, self-documenting, named as nouns.** `local.tunnel_cname` is unambiguous; `local.tmp` is not.
5. **Every sensitive output gets `sensitive = true`.** Prevents accidental log leaks.
6. **Resource naming.** `<provider>_<noun>.<role>_<qualifier>`. Examples: `cloudflare_dns_record.menu_iedora`, `cloudflare_r2_bucket.assets`.

### Removing resources without destroying them

Two declarative levers, paired:

- **`removed {}` block** — drops a resource from state. Use during a refactor when the resource moves elsewhere, gets renamed, or stops being managed.
- **`lifecycle { destroy = false }`** (OpenTofu 1.12+) on the same resource — when later removed from configuration, TF treats the destroy as a no-op (resource stays alive in the wild, just exits state).

Combined:

```hcl
removed {
  from = cloudflare_dns_record.legacy_subdomain
  lifecycle {
    destroy = false   # state-only removal; the DNS record stays in CF
  }
}
```

Anti-pattern: don't reach for `tofu state rm` from the CLI — leaves no audit trail. Keep the `removed {}` block in `.tf` for ONE PR cycle (state migration applies), then delete it.

### Closed-loop apply

```bash
tofu fmt
tofu validate                       # syntactic + provider-schema check
tofu plan -out=plan.bin             # see exactly what will change
# Eyeball. Unexpected destroys → STOP.
tofu apply plan.bin
```

If a `plan` is unreadable (hundreds of unrelated diffs), the change is too big — split it.
