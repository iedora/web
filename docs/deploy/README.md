# Iedora — Infrastructure, App State, and Deploy

> One doc, end-to-end. Architecture + commands + ops in one place. If
> something contradicts this, this wins — it's the only deploy doc.

**Operational lifecycle — three Days, jump to whichever fits:**

| | What | Runbook |
|---|---|---|
| **Day 0** | Wipe everything. Cloud + Tofu state + BWS managed-keys → zero. | [`day-0.md`](day-0.md) |
| **Day 1** | Cold-start deploy. Empty cloud → working `menu.iedora.com` + `core.iedora.com` + `iedora.com`. | [`day-1.md`](day-1.md) |
| **Day 2** | Ongoing operations. Logs, psql, backup/restore, secret rotation, auth re-bootstrap. | [`day-2.md`](day-2.md) |
| Troubleshooting | Failure modes + recovery, indexed by symptom. | [`troubleshooting.md`](troubleshooting.md) |

This document is the **architecture + pipeline reference**. The
day-by-day runbooks live in [`./`](ops/README.md).

## The pipeline

Four stages. Each runs independently and is idempotent. No task runner
— operators invoke `tofu` and `bin/iedora` directly under `bws run`.
CI: per-stage workflows under [.github/workflows/](../.github/workflows/).

```
Stage 1: Build & Test      per-product (bun, docker build, tests)
Stage 2: IaC               bin/iedora-env tofu -chdir=infra/iac/tofu apply
Stage 3: App state         bin/iedora-env bin/iedora app apply
Stage 4: Deploy            bin/iedora-env bin/iedora deploy <product>
```

**Hard split**: Tofu owns infrastructure ONLY — VPS, Cloudflare, GitHub
config, and the rendered docker-compose stack. Anything that lives
**inside** a running service (drizzle migrations on postgres,
OpenObserve dashboards, the menu app container) is **not** in Tofu.
App state belongs to Stage 3 (configurators) and Stage 4 (per-product
deploys).

**Container management**: Tofu renders `/etc/iedora/docker-compose.yml`
(via [`compose.tf`](../infra/iac/tofu/compose.tf)). The box runs the
stack via a systemd unit (`iedora.service`). cloud-init drops the
compose on first boot; [`terraform_data.iedora_sync`](../infra/iac/tofu/sync.tf)
SCPs new versions on day-2 changes and `systemctl restart
iedora.service` reconciles via `docker compose up -d --remove-orphans`.
The `kreuzwerker/docker` provider is intentionally NOT used.

## Environment guardrails

The non-negotiable rules. Everything else flexes around them.

### 1. Binary environment — `local` vs `live`, no staging

Code, infrastructure, and ops paths branch on exactly two values. No
`staging`, `preview`, `qa`, or `pre-prod` tier exists or will be
introduced.

|             | local                                  | live                              |
|-------------|----------------------------------------|-----------------------------------|
| Where       | operator's machine (`./bin/dev-stack`) | Hetzner + Cloudflare + GHCR |
| Targets     | Docker daemon on `localhost`; adobe/s3mock for S3 | Public APIs, real DNS    |
| Auth        | FirstInstance bootstrap; no BWS needed | BWS-stored, no defaults           |
| Side effects| freely destructible                    | gated by the guardrails below     |

Any feature that cannot run in `local` must fail at a preflight check
before touching `live` resources.

### 2. Tofu state lives in R2, never in git

The OpenTofu state file is **never committed** — encrypted or
otherwise. State is managed via Tofu's native `s3` backend pointed at
the `iedora-tofu-state` R2 bucket (S3-compatible, scoped API token).
Reason: race conditions on concurrent applies, lockfile-style state
locking, and the "encrypted binary in a 3-way git merge" failure mode.

Implementation lives at [§ State backend (R2)](#state-backend-r2)
below.

### 3. Database migrations are expansion-only

Migrations applied to a `live` Postgres must be non-destructive and
backward-compatible. Breaking schema changes ride a three-deploy
expand/contract:

| Deploy | What lands                                   | DB shape       |
|--------|----------------------------------------------|----------------|
| N      | Add the new column/table; old column stays   | both shapes    |
| N+1    | New code targets the new shape               | both shapes    |
| N+2    | Remove the old column once N is fully retired| new shape only |

Reason: Stage 3 (migrations) runs **before** Stage 4 (container swap).
Without expand/contract, a breaking migration kills the still-running
old container while Stage 4 is mid-pull.

Implementation: `gateMigrations` at
[`infra/app-state/menu-db-migrations/lint.go`](../infra/app-state/menu-db-migrations/lint.go)
scans `products/menu/drizzle/*.sql` for `DROP COLUMN` / `DROP TABLE`
/ `ALTER COLUMN ... TYPE` / `RENAME COLUMN` / `RENAME TABLE`. In
live mode, each destructive statement must carry an inline
`-- iedora:expand-contract phase=contract references=<expand-tag>`
marker (scoped to the same `--> statement-breakpoint` block) or the
configurator refuses to run. In local mode, violations log to
stderr but don't block. Tested via
[`lint_test.go`](../infra/app-state/menu-db-migrations/lint_test.go).

### 4. Stage 4 menu deploy is zero-downtime

`dockerOnHetzner.Deploy` must never stop the live container before its
replacement is healthy. The contract:

1. Pull image.
2. Start the incoming container as `infra-web-next` on the
   `iedora` network.
3. HTTP-probe `/up` on the new container until 200 OK (Go-native, no
   `curl` shell-outs).
4. Atomically re-alias `infra-web` (network alias swap — the CF Tunnel
   resolves the new container via docker DNS on the next request).
5. Stop + remove the old container.

Implemented in
[`infra/deploy/cmd/iedora/runtime_docker.go::dockerOnHetzner.deployHotSwap`](../infra/deploy/cmd/iedora/runtime_docker.go),
opted in by the `Healthcheck` field on the menu product literal in
[`products.go`](../infra/deploy/cmd/iedora/products.go). Tested via
[`runtime_docker_swap_test.go`](../infra/deploy/cmd/iedora/runtime_docker_swap_test.go)
(happy path, probe timeout, probe error, alias-swap failure, naive
fallback).


## Architecture

```
                            ┌──────────────────┐
                            │   operator        │
                            │   $ tofu apply         │
                            └────────┬──────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
 ┌──────────┐               ┌──────────────┐              ┌──────────────┐
 │ STAGE 2  │               │  STAGE 3     │              │   STAGE 4    │
 │   IaC    │  ───── then ──┤  AppState    │ ─── then ────│   Deploy     │
 │          │               │              │              │              │
 │ tofu     │               │ bin/iedora   │              │ bin/iedora   │
 │ apply    │               │ app apply    │              │ deploy menu  │
 └────┬─────┘               └──────┬───────┘              └──────┬───────┘
      │                            │                             │
      │ tofu apply                 │ walks                       │ pulls image,
      │  on infra/iac/tofu/        │ appConfigurators            │ hot-swap on box
      ▼                            ▼                             │
 ┌──────────┐               ┌──────────────────┐                 │
 │ Hetzner  │               │ menu-db-         │                 ├──► menu →
 │   VPS    │               │   migrations     │                 │     dockerOnHetzner
 │          │               │                  │                 │     SSH + docker pull/run
 │ + CF DNS │               │ openobserve-     │                 │     Serves BOTH
 │ + R2     │               │   dashboards     │                 │     menu.iedora.com
 │ + GH cfg │               │                  │                 │     and iedora.com
 │ + compose│               │ (core DB         │                 │     (proxy.ts rewrites
 │   stack  │               │  migrations:     │                 │      apex → /house/*)
 │   on box │               │  TODO phase-1-   │                 │
 │          │               │  sweep)          │                 │
 └────┬─────┘               └────┬─────────────┘                 │
      │ writes via               │ writes
      │ terraform_data           │
      ▼                          ▼
            ┌──────────────────────────────────┐
            │             BWS                  │
            │  IAC_BOOTSTRAP_*  (operator)     │
            │  IAC_*            (Tofu mints)   │◄─── reads ── Stage 4
            │  APP_*            (Stage 3 mints)│◄─── reads ── Stage 4
            │  DEPLOY_<prod>_*  (Stage 4 mints)│◄─── mint+read Stage 4
            └──────────────────────────────────┘
```

**Key invariants:**

- Tofu never reads BWS keys outside its stage classification.
- Stage 3 configurators each own their target's health gate +
  credential fetch + idempotent reconcile. The orchestrator iterates
  the registry — no per-target conditional logic.
- Stage 4 runtimes are polymorphic. Adding a Docker product = struct
  literal. Adding a non-Docker runtime = one new `runtime_<kind>.go`.
- BWS is the bus. Stage 3 writes app-state outputs + per-product app
  secrets; Stage 4 reads. No Tofu round-trips for app values.
- Stage isolation via SSH+localhost tunnels for internal-only services
  (`openobserve-dashboards` is the pattern reference).

## Stage 1 — Build & Test

Per-workspace CI, all triggered in parallel on push (paths-filtered):

- **`[product:menu] CI`** (`.github/workflows/product-menu.yml`) —
  typecheck + lint + Vitest (PGLite) + Playwright E2E for the menu
  slices. Owns the menu product's quality bar.
- **`[product:core] CI`**, **`[product:house] CI`** — typecheck +
  lint + Vitest for the auth/admin surface and the apex landing.
- **`[package:*] CI`** — same shape for each shared package
  (`@iedora/auth`, `@iedora/design-system`, `@iedora/observability`,
  …).
- **`[apps:web] CI`** (`.github/workflows/web.yml`) — typecheck + lint
  + Trivy/SBOM on the shell, then on push to main runs the **native
  arm64 build** on `ubuntu-24.04-arm` → `docker buildx` →
  `ghcr.io/eduvhc/web:latest` + `:<sha>` + SLSA build provenance
  attestation. Single arch (Hetzner CAX is arm64); no QEMU, no
  manifest list to stitch. On `main` the workflow then chains into
  Stage 3 wait + Stage 4 deploy via `workflow_call` on `deploy.yml`.

Per-product / per-package workflows are NOT a gate on `[apps:web] CI`
— each runs on its own paths-filter and pushes a status to branch
protection. The previous `wait_products` polling job was removed (it
serialised what should run concurrently).

The previous separate `house.yml` workflow + Astro + CF Workers Static
Assets deploy was retired when iedora.com was folded into the web
Next.js shell — see `apps/web/src/app/house/`.

Local: `bun run typecheck`, `bun run test`, `bun run build`. Each
product already has its own conventions.

## Stage 2 — IaC (`bin/iedora-env tofu -chdir=infra/iac/tofu apply`)

Plain `tofu apply` on [`infra/iac/tofu/`](../infra/iac/tofu/). Owns:

- **Hetzner VPS, firewall, SSH key, cloud-init** ([hetzner.tf](../infra/iac/tofu/hetzner.tf))
- **Cloudflare** R2 buckets, DNS records, scoped API tokens
  ([main.tf](../infra/iac/tofu/main.tf))
- **GitHub Actions config** — secrets + variables on the repo, via the
  `integrations/github` provider ([github.tf](../infra/iac/tofu/github.tf))
- **The rendered docker-compose stack** ([compose.tf](../infra/iac/tofu/compose.tf))
  — yamlencode'd document covering:
  - `infra-postgres` (Postgres 18, menu + core databases)
  - `infra-cloudflared` (Zero Trust Tunnel connector — public ingress)
  - `infra-openobserve` (observability backend, bound to 127.0.0.1:5080)
  - `infra-pg-backup` (daily pg_dumpall → R2 GPG-encrypted)
- **Day-2 sync** ([sync.tf](../infra/iac/tofu/sync.tf)) — single
  `terraform_data` resource that SCPs `compose.yml` to `/etc/iedora/`
  and restarts `iedora.service` when the compose hash changes.
- **Destroy-time R2 purge** ([destroy-hooks.tf](../infra/iac/tofu/destroy-hooks.tf))
  — `rclone purge` provisioners that empty the R2 buckets before the CF
  API DELETE (otherwise: 409 on non-empty bucket).
- **Random passwords minted by Tofu, written through to BWS** as
  `IAC_*` ([secrets.tf](../infra/iac/tofu/secrets.tf)) — postgres
  pwd, backup passphrase, openobserve pwd. The Hetzner IPv4 also
  writes through here so Stage 3 configurators can find the box.

**Does NOT own:**

- The web container — Stage 4 (`dockerOnHetzner`).
- DB migrations, OO dashboards — Stage 3.
- The `IEDORA_CORE_SECRET` for better-auth — Stage 4 (`appSecrets`,
  minted on first deploy).

### Single-pass apply

`tofu apply` runs once with default parallelism. No `kreuzwerker/docker`
provider on the apply graph means no per-container SSH and no
MaxStartups concern. The only SSH on the graph is
`terraform_data.iedora_sync` — one session per compose hash change.

**Prerequisites on the operator's machine**: `tofu`, `bws`, `rclone`
(for destroy-time purge). All `brew install` away.

### State backend (R2)

State lives in the `iedora-tofu-state` R2 bucket via the OpenTofu
`s3` backend. One root today:

- `infra/iac/tofu/` → `infra/iac/tofu/terraform.tfstate`

(The previous standalone `house` product root was retired when iedora.com
was folded into the menu Next.js app at `apps/web/src/app/house/` —
no more CF Workers Tofu plumbing.)

The state object is still encrypted at rest by Tofu's PBKDF2 +
AES-GCM `encryption {}` block (passphrase from
`IAC_BOOTSTRAP_STATE_PASSPHRASE`) — R2 only ever sees encrypted bytes.
Concurrent applies are gated by R2-native `use_lockfile = true` (a
sidecar `.tflock` object in the same bucket prefix).

The R2 bucket + scoped API token are out-of-band; they're minted by
`bin/state-bucket-bootstrap` (chicken/egg — Tofu can't manage the
bucket that stores its own state).

## Stage 3 — App state (`bin/iedora-env bin/iedora app apply`)

Walks the configurator registry in
[`infra/deploy/cmd/iedora/configurators.go`](../infra/deploy/cmd/iedora/configurators.go).
Each configurator is a separate binary that owns one running shared
service's application-level configuration.

### The contract

The orchestrator is **dumb on purpose** — it just iterates the registry
and execs each binary. Each binary is responsible for:

1. **Health-gating its target service** (TLS probe, port check,
   `/healthz` poll).
2. **Locating its own credentials** (BWS, env, fetched on demand).
3. **Idempotent reconcile** + recovery for one-shot reveals.

Adding a new configurator = one struct literal in `configurators.go` +
the binary anywhere under `infra/`.

### Current configurators (run in order)

#### `core-db-migrations` → [`infra/app-state/core-db-migrations`](../infra/app-state/core-db-migrations/) (in-process)

drizzle-kit migrate against the `core` Postgres database — the
`@iedora/auth` schema (user / session / account / verification /
organization / member / invitation / rate_limit). SSHes to the box,
runs `docker run --rm --network iedora -e CORE_DATABASE_URL=...
ghcr.io/<owner>/web:<IMAGE_SHA> node /app/packages/auth/scripts/migrate.mjs`.

Runs **first** so the web container — which reads `core.session` rows
on every request — boots against a migrated schema. The migrate script
lives in the web image because `@iedora/auth` is a workspace dep:
`apps/web/next.config.ts::outputFileTracingIncludes` force-bundles
`packages/auth/{drizzle,scripts/migrate.mjs}` into Next's standalone
output, so they're addressable at `/app/packages/auth/...` inside the
container. Same image, same docker network, same pull dance as
`menu-db-migrations` — one less artifact to ship.

`pg_advisory_lock(1296515955)` guards against concurrent runs.

#### `menu-db-migrations` → [`infra/app-state/menu-db-migrations`](../infra/app-state/menu-db-migrations/) (in-process)

drizzle-kit migrate against the `menu` postgres database. SSHes to the box,
runs `docker run --rm --network iedora -e DATABASE_URL=...
ghcr.io/<owner>/web:<IMAGE_SHA> node scripts/migrate.mjs`.

The migrate script holds `pg_advisory_lock(727072073)` for
concurrent-deploy safety. Inputs: `IMAGE_SHA` env (default
"latest"), `hetzner_ipv4` + `menu_database_url` from `tofu output`
(nested `bin/iedora-env --stage iac` call — Stage 3's env scope
doesn't include the postgres password directly).

**docker login** before pull: Stage 3 runs with `IAC_BOOTSTRAP_GHCR_TOKEN`
in scope (universal), the binary `docker login ghcr.io
--password-stdin` before each pull.

**Why this is Stage 3 and not in Stage 4's `dockerOnHetzner`**: a bad
migration fails loud in the deploy log without crash-looping the live
web container. Multi-replica future is also unblocked — migrations
run once per deploy, not once per replica boot.

#### `openobserve-dashboards` → [`infra/app-state/openobserve-dashboards`](../infra/app-state/openobserve-dashboards/) (in-process)

Pushes 3 dashboards (`business`, `technical`, `correlation`) to the
running OpenObserve. JSONs are embedded in the binary via
`//go:embed dashboards/*.json` — no scp dance, no version skew.

**Network path**: OO in prod is internal-only (`expose_host_ip =
127.0.0.1` + Hetzner edge firewall blocks 5080 publicly). Binary opens
an SSH local-forward tunnel `ssh -L 15080:localhost:5080 -N
root@$IAC_BOOTSTRAP_HOST_IP`, then HTTP from operator's `http://127.0.0.1:15080`.
Tunnel torn down on `defer Close()`.

**Idempotent reconcile**: list dashboards in folder → match by title
across OO's many version-slot shapes (top-level / `v1..v8` / `result` /
`list` / `dashboards`) → PUT-with-optimistic-concurrency-hash on hit,
POST on miss.

**Health gate**: `GET /healthz` over the tunnel (30s budget).

### Future configurators (worth knowing about)

Add by appending one struct literal to `appConfigurators` + the binary.
Likely future entries: per-product DB role provisioner, S3 bucket
policies on a future internal MinIO.

## Stage 4 — Deploy (`bin/iedora-env bin/iedora deploy <product>`)

Per-product. Fans out across the registry in
[`infra/deploy/cmd/iedora/products.go`](../infra/deploy/cmd/iedora/products.go). Each
product has a `productRuntime` — the polymorphism point for "how does
this product get shipped to its runtime."

### Current runtimes

#### `dockerOnHetzner` → menu

For Docker-runtime products that run on the shared Hetzner VPS.

**Deploy flow** — zero-downtime hot-swap per [Guardrail #4](#4-stage-4-menu-deploy-is-zero-downtime):

1. Mint any per-product `appSecrets` not yet in BWS (menu mints
   `DEPLOY_MENU_IEDORA_CORE_SECRET` on first deploy — the
   `IEDORA_CORE_SECRET` better-auth signs session tokens with).
2. Resolve box IPv4 from `tofu output -raw hetzner_ipv4`.
3. Compose env from `envStatic` + `envFromBWS` (Stage 3 outputs +
   AUTOGEN secrets) + `envFromTofu` (DATABASE_URL, OTEL endpoint, S3
   creds, etc. — composed values from Tofu state).
4. SSH to box, `docker login ghcr.io`, `docker pull <image>:<sha>`.
5. `docker run -d --name infra-web-next --network-alias
   infra-web-next ...` — start the incoming container alongside
   the live one. Only the `-next` alias is bound, so the CF Tunnel
   keeps routing traffic to the OLD container.
6. Probe `docker exec infra-web-next wget -qO- -T 5
   http://localhost:3000/up` every 500ms until the body contains
   `"ok":true` (60s budget). On timeout / failure: best-effort tear
   down `infra-web-next` and surface the probe error — the live
   container is never touched.
7. Atomic cutover in one SSH command:
   `docker network disconnect iedora infra-web &&
   docker network disconnect iedora infra-web-next &&
   docker network connect --alias infra-web --alias
   infra-web-next iedora infra-web-next`. Docker DNS
   re-resolves the alias for the cloudflared container, so the
   next request through the tunnel lands on the new container.
8. Drain for `DrainDuration` (default 10s) — pure Go sleep, no shell
   sleep — so in-flight requests on the old container finish before
   SIGTERM.
9. `docker stop infra-web && docker rm infra-web` — reap
   the old container.
10. `docker rename infra-web-next infra-web` so the next
    deploy starts from the same naming baseline.

Rollback semantics: a failure at step 6 or 7 runs `docker stop / rm /
network disconnect` against the `-next` container only. The OLD
container — still bound to the live alias — keeps serving traffic.

**Inputs**:
- `IMAGE_SHA` env — set by CI (`github.sha`) or operator (export).
  Default "latest". (Env-var name kept its historical `MENU_` prefix;
  it's the image SHA for the `web` artifact today.)
- `IAC_BOOTSTRAP_HOST_IP` — universal-scope BWS key, written by Stage 2.
- All `envFromBWS` keys — visible in `--stage deploy --product web`
  scope.

**CF Tunnel routing**: `cloudflared` resolves `infra-web` by docker
network alias via the tunnel ingress rules in `tunnel.tf`. Between deploys
(container stopped) it returns 502 — correct behavior; restored as soon
as Stage 4 lands.

#### `cloudflareWorker` (currently no products use it)

Implementation kept at `runtime_cf.go` as a stable abstraction for any
future static-site product. House was the original consumer; it moved
into the menu Next.js app at `src/app/house/` and the runtime fell
dormant. If/when a Workers-shipped product comes back:

1. `bun run build` in `products/<name>/`.
2. `tofu init -upgrade` in `products/<name>/infra/iac/tofu/`.
3. `tofu apply -auto-approve` — uses
   `cloudflare/cloudflare 5.11+`'s native dist/ upload directly inside
   `cloudflare_workers_script`, no wrangler needed.

### Adding a product

1. `mkdir products/<name>/` with build config.
2. (Optional) `products/<name>/infra/iac/tofu/` for per-product cloud
   resources (own R2 bucket, custom domain, workers script).
3. One struct entry in `products.go` selecting a `productRuntime`. If
   the deploy shape is new (not Docker, not CF Workers), add a new
   `runtime_<kind>.go` implementing the `productRuntime{Deploy,
   Destroy}` interface.
4. `.github/workflows/<name>.yml` — copy web.yml, swap names.
   Dispatches the reusable
   [`deploy.yml`](../../.github/workflows/deploy.yml) workflow with
   `inputs.product = <name>`.

Zero orchestrator code changes needed.

## Stage-filtered secrets

`bin/iedora-env [--stage iac|app|deploy] [--product NAME] -- <cmd>`.
Defense-in-depth — each stage sees only its classified BWS keys.
Unclassified keys never enter the spawned process's env.

### Naming taxonomy

| Prefix              | Owns lifecycle      | Examples                                                                                          |
|---------------------|---------------------|---------------------------------------------------------------------------------------------------|
| `IAC_BOOTSTRAP_*`   | Operator (manual)   | `IAC_BOOTSTRAP_HCLOUD_TOKEN`, `IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN`, `IAC_BOOTSTRAP_GHCR_TOKEN`     |
| `IAC_*`             | Tofu (Stage 2)      | `IAC_POSTGRES_PASSWORD`, `IAC_BACKUP_PASSPHRASE`                                                  |
| `APP_<service>_*`   | Stage 3 configurator| (none today — was the home of Zitadel outputs; future `core-db-migrations` may add some)         |
| `DEPLOY_<product>_*`| Stage 4 productRuntime | `DEPLOY_MENU_IEDORA_CORE_SECRET`                                                              |

The prefix tells you who writes the value — which means it also tells
you where to look when it goes wrong and which `--stage` will surface
it. Rotation playbooks for each prefix are in § Secret rotation below.

| Stage  | Visible BWS keys                                                                                                                |
|--------|---------------------------------------------------------------------------------------------------------------------------------|
| iac    | Provider creds (Hetzner, CF, GH), state passphrase, all IAC_*, OO email/password                                      |
| app    | IAC_BOOTSTRAP_GHCR_TOKEN (for menu-db-migrations pulls), OO email/password (dashboards Basic auth), universal keys |
| deploy | Universal + CF/state (for per-product Tofu) + IAC_BOOTSTRAP_GHCR_TOKEN (docker pull) + per-product extras gated by `--product`          |

Per-product extras for `--product menu`: `DEPLOY_MENU_IEDORA_CORE_SECRET`.

TF_VAR_* aliases auto-emitted only for stages that use Tofu (iac,
deploy). App stage doesn't get TF_VARs.

Env resolution is tested via the integration of `bin/iedora-env` across
all stages; see the pre-merge runbook below for the end-to-end coverage.

## Local commands

```bash
bin/iedora-env bin/iedora doctor                            # Preflight: PATH, BWS auth, bootstrap secrets.

# Stage 2 — IaC
bin/iedora-env tofu -chdir=infra/iac/tofu init -upgrade     # First-time / after provider bumps.
bin/iedora-env tofu -chdir=infra/iac/tofu plan              # Dry-run.
bin/iedora-env tofu -chdir=infra/iac/tofu apply             # Apply.
bin/iedora-env tofu -chdir=infra/iac/tofu destroy           # Teardown.
bin/iedora-env tofu -chdir=infra/iac/tofu fmt -recursive    # Format .tf files.

# Stage 3 — App state
bin/iedora-env bin/iedora app apply                         # Every configurator.

# Stage 4 — Deploy
bin/iedora-env bin/iedora deploy menu                       # Menu.
bin/iedora-env bin/iedora destroy menu                      # Tear down menu's stage-4 artifacts.

# Local dev stack
./bin/dev-stack                                 # Boot.
./bin/dev-stack --destroy                       # Wipe.
./bin/dev-stack --reset-db menu                 # Drop+recreate one DB.

# Pre-merge runbook — manual chain, ~45-60 min on live.
bin/iedora-env tofu -chdir=infra/iac/tofu destroy           # 1: tear down
bin/iedora-env tofu -chdir=infra/iac/tofu apply             # 2: cold deploy
bin/iedora-env tofu -chdir=infra/iac/tofu apply             # 3: warm (no-diff)
bin/iedora-env tofu -chdir=infra/iac/tofu destroy           # 4: tear down again
bin/iedora-env tofu -chdir=infra/iac/tofu apply             # 5: cold deploy AGAIN
bin/iedora-env tofu -chdir=infra/iac/tofu apply             # 6: warm (no-diff)
```

`bws run` hydrates every BWS secret into the child process's env (no
stage filtering — that defense-in-depth was dropped along with the
`with-secrets` wrapper). `bin/iedora` is the Stage 3 + Stage 4 router;
each `bin/<configurator>` is independently invocable for ad-hoc work.

## CI flow

Per-stage workflows. Each is independently dispatchable; the chain
flows via `workflow_run` triggers.

| Workflow | Stage | Trigger |
|----------|-------|---------|
| [`infra-deploy.yml`](../../.github/workflows/infra-deploy.yml) | 2 | push to main on `infra/iac/**`, `internal/**`, `bin/state-bucket-bootstrap`, `go.{mod,sum}`. Manual dispatch. |
| [`app-state.yml`](../../.github/workflows/app-state.yml)       | 3 | `workflow_run` on infra-deploy success. Also: push on `infra/app-state/menu-db-migrations/**`, `infra/app-state/openobserve-dashboards/**`. Manual dispatch. |
| [`product-{menu,core,house}.yml`](../../.github/workflows/) | 1 | push to main on `products/<x>/**`. Per-product CI (typecheck + lint + test). No deploy chain — these are quality gates on branch protection. |
| [`{auth,design-system,observability}.yml`](../../.github/workflows/) | 1 | push to main on `packages/<x>/**`. Per-package CI. |
| [`web.yml`](../../.github/workflows/web.yml)                 | 1+4 | push to main on `apps/web/**`. Gates (typecheck + lint + security) → arm64 build + GHCR push → wait_app_state → `deploy.yml(product=web, sha=...)`. Ships menu.iedora.com + core.iedora.com + iedora.com (one image, host-based rewrite). |
| [`deploy.yml`](../../.github/workflows/deploy.yml)             | 4 | reusable `workflow_call` invoked by `web.yml`. Generic over `product`. |

Every workflow runs commands under `bin/iedora-env` so CI sees the same
hydrated BWS env operators do — that helper exports the `TF_VAR_*`,
`AWS_*`, and `CLOUDFLARE_ACCOUNT_ID` aliases everything downstream
expects.

State commit-back: both `infra-deploy.yml` and the per-product Tofu
side of `deploy.yml` commit the encrypted `terraform.tfstate` back to
`main` after a successful apply — git stays canonical.

## Local stack (`./bin/dev-stack`)

Boots postgres, adobe/s3mock, openobserve, and menu on your machine.
See **[docs/dev.md](dev.md)** for the full guide — services, flags,
environment files (`.env` vs `.env.local`), HMR workflow, and lifecycle.

## Day 2 — Ongoing operations

Moved to [`day-2.md`](day-2.md) — logs, psql, backup/restore,
secret rotation, auth re-bootstrap.

## Day 0 — Wipe everything (clean slate)

Moved to [`day-0.md`](day-0.md) — the full destroy procedure
(tofu destroy with the active-tunnel retry loop, orphan-inventory via
API, optional Stage -1 deep-wipe).

## Day 1 — Cold-start deploy

Moved to [`day-1.md`](day-1.md) — prerequisites + the canonical
deploy sequence (state-bucket-bootstrap → tofu apply → core schema →
app apply → deploy menu → smoke test).

## Failure modes / troubleshooting

Moved to [`troubleshooting.md`](troubleshooting.md) — symptom →
cause → recovery table.

## IaC test layers

Five layers, cheapest → most expensive. Each catches a different class
of bug. Pick the cheapest one that can prove what you need; escalate
only when you have to. Layer 5 (the pre-merge runbook, below) is the
gate before shipping IaC changes to `main`.

### Layer 1 — Render-time (no cloud APIs, ~30 s, free)

```bash
tofu -chdir=infra/iac/tofu fmt -check -recursive
tofu -chdir=infra/iac/tofu validate
bin/iedora-env tofu -chdir=infra/iac/tofu init -input=false -upgrade
bin/iedora-env tofu -chdir=infra/iac/tofu plan
# Optionally inspect rendered locals:
bin/iedora-env tofu -chdir=infra/iac/tofu console <<< 'nonsensitive(local.compose)'
```

**Catches**: HCL parse errors, `yamlencode` / `templatefile` / `indent`
mistakes, unresolved variable references, drift between
`triggers_replace` keys and the values they hash.

**Does NOT catch**: cloud-init runtime errors, provider behaviour
quirks, anything that needs `random_password` / cloud-API computed
values (those are `(known after apply)` at plan time).

### Layer 2 — Cold apply (~5–10 min, ~€0.01)

```bash
bin/iedora-env tofu -chdir=infra/iac/tofu apply
```

Provisions everything from an empty state. SSH into the box and
verify each container:

```bash
HOST=$(bin/iedora-env tofu -chdir=infra/iac/tofu output -raw hetzner_ipv4)
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$HOST \
  'docker compose -f /etc/iedora/docker-compose.yml ps'
curl -sI https://menu.iedora.com/up | head -1   # → HTTP/2 200
```

**Catches**: cloud-init failures (missing packages, bad write_files
indent), provider quirks, the `terraform_data.iedora_sync` SSH push
working at all, CF Tunnel cert provisioning, the docker-compose YAML
actually being valid (this only fires on `docker compose up` on the
box — `tofu plan` doesn't run compose).

### Layer 2.5 — Warm apply (idempotency, < 1 min)

```bash
bin/iedora-env tofu -chdir=infra/iac/tofu apply
```

Immediately re-run. Expected: `Apply complete! Resources: 0 added, 0
changed, 0 destroyed.`

**Catches**: non-deterministic `yamlencode` ordering, unstable
`triggers_replace` hashes (compose, systemd unit). If
*anything* shows as changed on a no-op re-apply, a sync resource
will fire spuriously on every future apply.

### Layer 3 — Day-2 simulation (~2 min)

Edit a single container env in `compose.tf` (e.g. flip
`BACKUP_KEEP_DAYS`), re-apply.

```bash
# Expected plan: 1 to add, 0 to change, 1 to destroy
#   (only terraform_data.iedora_sync recreates)
bin/iedora-env tofu -chdir=infra/iac/tofu apply

# On the box: ONLY the affected container should be recreated.
# postgres, cloudflared, openobserve should preserve their uptime.
ssh root@$HOST 'docker ps --format "{{.Names}}\t{{.RunningFor}}"'
```

**Catches**: regressions where a small config change bounces the
whole stack (the `systemctl reload` vs `restart` finding — see
`sync.tf`).

### Layer 4 — Destroy (~3 min, frees all paid resources)

```bash
bin/iedora-env tofu -chdir=infra/iac/tofu destroy
```

Expected: `Destroy complete! Resources: N destroyed.` with no R2 409s,
no Hetzner orphans, no stale BWS `IAC_*` keys.

**Catches**: missing destroy hooks (rclone purge before bucket
DELETE), rate-limit problems on parallel mutating ops (BWS 429 →
`bws-sync` batched fix), `prevent_destroy` lifecycle blocks that
need an explicit override.

**Rclone is a hard prereq** — `brew install rclone` first.

### Layer 5 — Pre-merge runbook (~30–45 min, real cloud cycle)

Full `down → up → up → down → up → up` chain — see § Pre-merge
runbook below. The second cold/warm pair is the load-bearing test:
catches DNS races, one-shot reveal recovery, cross-stage drift that
no single-apply path exposes. Run before merging any IaC change to
`main`.

## Pre-merge runbook

Run before merging any change to the orchestrator (`infra/deploy/cmd/iedora/`,
`infra/app-state/`, `infra/iac/tofu/*.tf`, `internal/*`, `bin/*`,
`apps/web/**` (which now also hosts iedora.com), or `infra/iac/**/*.tf`). The sequence proves
the moving parts compose correctly against live cloud APIs — unit
tests cover individual helpers but only this catches cross-API
problems (DNS races, state-vs-cloud drift, one-shot reveal recovery).

```bash
bin/iedora-env tofu -chdir=infra/iac/tofu destroy       # 1: tear down from any state — idempotent
bin/iedora-env tofu -chdir=infra/iac/tofu apply  # 2: cold deploy (full bootstrap)
bin/iedora-env tofu -chdir=infra/iac/tofu apply  # 3: warm — every stage should be no-diff/no-op
bin/iedora-env tofu -chdir=infra/iac/tofu destroy       # 4: destroy from a full estate
bin/iedora-env tofu -chdir=infra/iac/tofu apply  # 5: cold deploy AGAIN — catches state-vs-cloud drift, DNS races
bin/iedora-env tofu -chdir=infra/iac/tofu apply  # 6: warm — final idempotency check
```

The second cold/destroy pair (4→5) is the load-bearing test. It
catches CF DNS / cert propagation races and the OO dashboards'
tunnel-then-reconcile flow on a fresh target.

**One failed step ⇒ do not merge.**

### What each step asserts

| Step | What it proves |
|------|----------------|
| 1. destroy | `tofu destroy` works from any state. R2 buckets emptied via rclone hooks; BWS keys scrubbed via `bin/bws-sync` batched destroy. |
| 2. cold deploy | Full bootstrap: Tofu resources up, both Stage 3 configurators run cold, web deploys (serves menu.iedora.com + core.iedora.com + iedora.com from one image). |
| 3. warm deploy | Idempotency at every stage. Stage 2: `0 added, 0 changed, 0 destroyed`. Stage 3: all "updated" or "no diff". Stage 4: re-pull same SHA → no container restart. |
| 4. destroy (full) | R2 emptying works against real R2 (rclone). |
| 5. cold deploy #2 | CF DNS / cert propagation races caught; configurators recover from a fresh estate. |
| 6. warm deploy | Final no-op. |

### Expected state after a cold deploy

- **Tofu state** (`infra/iac/tofu/`): ~23 resources (hcloud VPS/firewall/key, cloudflare R2/DNS/api_tokens incl. iedora.com apex + www + core, tunnel + tunnel-config, random_password.*, terraform_data.{bws_sync,iedora_sync,data_bucket_purge,assets_bucket_purge}).
- **BWS**: `DEPLOY_IEDORA_CORE_SECRET` minted by Stage 4 + `IAC_BOOTSTRAP_HOST_IP` + autogen passwords from `bws_sync`.
- **Box** (`ssh root@$HOST docker ps`): `infra-postgres`, `infra-cloudflared`, `infra-openobserve`, `infra-pg-backup` (compose-managed via `iedora.service`) + `infra-web` (Stage-4-owned, NOT in compose).
- **Public endpoints**:
  - `https://menu.iedora.com/up` → 200 `{"ok":true,"db":"ok"}`
  - `https://core.iedora.com` → 200 (sign-in landing — served by web container via `proxy.ts` Host rewrite)
  - `https://iedora.com` → 200 (apex landing — served by web container via `proxy.ts` Host rewrite)

## File map

```
bin/                                     `go run` / `bash` shims operators invoke directly
  iedora-env                               BWS → TF_VAR_* / AWS_* / CLOUDFLARE_ACCOUNT_ID hydration
  iedora                                   → infra/deploy/cmd/iedora (Stage 3 + Stage 4)
  state-bucket-bootstrap                   → infra/iac/cmd/state-bucket-bootstrap (Stage -1)
  bws-sync                                 → infra/iac/cmd/bws-sync (Tofu local-exec helper)

infra/deploy/cmd/iedora/                  Stage 3 + Stage 4 orchestrator
  main.go, app.go, deploy.go, doctor.go
  runtime.go, runtime_docker.go            productRuntime interface + the only impl
  configurators.go                         Stage 3 registry
  products.go                              Stage 4 registry
  ssh.go, paths.go, log.go

infra/app-state/                         Stage 3 — each subdir is a self-contained configurator
  core-db-migrations/                      drizzle-kit migrate against the `core` DB (@iedora/auth schema)
  menu-db-migrations/                      drizzle-kit migrate against the `menu` DB
  openobserve-dashboards/                  SSH-L tunnel + go:embed JSONs + REST upsert

internal/                                Shared Go helpers (repo-root single Go module)
  bws/                                     bws CLI wrapper (ProjectID, ListSecrets, Find, Upsert, Delete)
  cloudflare/                              CF /accounts API + R2 S3 creds derivation
  mode/                                    binary-mode enum (local vs live; Guardrail #1)
  r2/                                      R2 S3 client (EmptyBucket for destroy)
  tlsprobe/                                `Wait()` for /debug/ready + CF-edge cert probe
  testfakes/                               test-only HTTP server fakes

infra/                                   Stage 2 — IaC for the shared estate
  iac/
    tofu/                                  central Tofu root
      versions.tf, variables.tf, hetzner.tf, main.tf, compose.tf,
      tunnel.tf, sync.tf, destroy-hooks.tf, secrets.tf, outputs.tf
      templates/{cloud-init.yml,iedora.service}
    cmd/
      bws-sync/                            Batched BWS write/delete (Tofu local-exec entry point)
      infra-pg-backup/                     Postgres-backup container (Go + Dockerfile, arm64)
      state-bucket-bootstrap/              Stage -1 — R2 bucket + token bootstrap
    postgres/                              init.sql — CREATE DATABASE menu / core on first boot

dev/                                     Local stack (mirror of Stages 2-4)
  docker-compose.yml                        the stack itself
  bin/                                      Shim entry points — see docs/dev.md
```

## Scaling notes — multi-machine, multi-agent

The model above is designed for multiple operators (and multiple Claude
agents in different worktrees) hitting the same `live` environment.
Three load-bearing properties:

1. **R2 state + native locking (`use_lockfile = true`).** Two concurrent
   `tofu apply` invocations from different machines / agents serialize
   via a sidecar `.tflock` object. Without this, you'd race state
   updates. State-in-git would be worse — every apply becomes a merge
   conflict on `terraform.tfstate.encrypted`.

2. **BWS as the single source of truth for secrets.** Every machine /
   agent / CI runner authenticates with a `BWS_ACCESS_TOKEN`; one env
   var unlocks the same secret set everywhere. New agent comes online →
   set the token once → every `bin/iedora-env …` command works. The
   `IAC_BOOTSTRAP_*` keys are pasted **once per environment, not once
   per agent**; subsequent agents inherit the already-bootstrapped state.

3. **`bin/state-bucket-bootstrap` is a per-environment one-shot.** A new
   agent on a new machine does NOT run it — the bucket already exists,
   so day-1 for that agent looks identical to day-2 for everyone else:
   ```bash
   bin/iedora-env tofu -chdir=infra/iac/tofu apply
   ```

### Multi-agent operating conventions

Agents `tofu plan` in their worktrees to validate proposed changes
locally — but `tofu apply` runs only from `main` via CI. This avoids
two agents on different branches applying conflicting state (the lock
keeps it correct, but you'd still waste apply time fighting over state
versions). The convention:

- **Local** — `bin/iedora-env tofu -chdir=infra/iac/tofu plan` (read-only).
- **CI** — `bin/iedora-env tofu -chdir=infra/iac/tofu apply` (mutating),
  triggered by push to `main` via `infra-deploy.yml`.

`workflow_dispatch` on `infra-deploy.yml` is a manual escape hatch —
use sparingly, document why.

### Follow-ups worth doing as scale grows

These are NOT required for the current size, but become attractive
as the operator / agent count rises:

- **GitHub OIDC → BWS workload identity.** Replace the long-lived
  `BWS_ACCESS_TOKEN` GHA secret with per-workflow-run short-lived
  tokens. Audited, zero long-lived secrets in GitHub. Blocked on BWS
  exposing an OIDC federation endpoint — check Bitwarden's roadmap.
- **Per-operator BWS access tokens.** Each human operator + each agent
  gets its own token. Today everyone shares the project token; this is
  fine for solo + a handful of agents, less fine at >5 humans.
- **PR-driven applies** (Atlantis / Spacelift / Tofu Cloud). Plans
  attached to PRs as comments, apply on merge. Standard at >10 people.
  Massive overkill until then.

## Why this design

- **Tofu is great at provisioning, bad at app config.** Cloud APIs are
  CRUD-with-stable-IDs — Tofu's wheelhouse. App-level APIs (drizzle
  migrate, OpenObserve dashboards) are imperative and need ordering
  across resources. A bespoke reconciler that knows the app's quirks
  is better here.

- **Stage isolation matches blast radius.** A bug in a Stage 3
  configurator can't touch Tofu state. A typo in
  `apps/web/src/app/house/page.tsx` only affects the iedora.com
  landing — the menu app still ships. Each stage is independently
  runnable for surgical re-rolls (`bin/iedora-env bin/iedora app apply
  --only menu-db-migrations`).

- **Adding products + configurators is mechanical.** New product =
  struct literal + 1 workflow file. New Stage 3 configurator = struct
  literal + 1 binary. No orchestrator code changes.

- **BWS as the bus** means no Tofu round-trips for app values. Stage 3
  writes outputs; Stage 4 reads them directly. The encrypted Tofu state
  is canonical for infra; BWS is canonical for app state.

Historical note: the Zitadel-as-IdP era of this design (a Stage 3
`zitadel-apply` configurator that reconciled an external Zitadel
container via REST) was retired when auth moved in-process via
`@iedora/auth` (better-auth). The remaining Stage 3 surface is much
smaller — just menu-db-migrations + openobserve-dashboards (plus
`core-db-migrations` to come).
