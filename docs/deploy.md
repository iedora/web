# Iedora — Infrastructure, App State, and Deploy

> One doc, end-to-end. Architecture + commands + ops in one place. If
> something contradicts this, this wins — it's the only deploy doc.

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
**inside** a running service (Zitadel org/project/PAT, drizzle
migrations on postgres, OpenObserve dashboards, the menu app container)
is **not** in Tofu. App state belongs to Stage 3 (configurators) and
Stage 4 (per-product deploys).

**Container management**: Tofu renders `/etc/iedora/docker-compose.yml`
(via [`compose.tf`](../infra/iac/tofu/compose.tf)). The box runs the
stack via a systemd unit (`iedora.service`). cloud-init drops the
compose on first boot; [`terraform_data.iedora_sync`](../infra/iac/tofu/sync.tf)
SCPs new versions on day-2 changes and `systemctl restart
iedora.service` reconciles via `docker compose up -d --remove-orphans`.
The `kreuzwerker/docker` provider is intentionally NOT used.

## Environment guardrails

The non-negotiable rules. Everything else flexes around them. Where a
guardrail is not yet enforced by today's code, the row links to the
implementation plan in
[guardrails-implementation.md](./guardrails-implementation.md).

### 1. Binary environment — `local` vs `live`, no staging

Code, infrastructure, and ops paths branch on exactly two values. No
`staging`, `preview`, `qa`, or `pre-prod` tier exists or will be
introduced.

|             | local                                  | live                              |
|-------------|----------------------------------------|-----------------------------------|
| Where       | operator's machine (`go run ./dev/cmd/local-stack`) | Hetzner + Cloudflare + GHCR |
| Targets     | Docker daemon on `localhost`; LocalStack for S3 | Public APIs, real DNS    |
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
below, with the bootstrap details in
[guardrails-implementation.md § Rule 2](./guardrails-implementation.md#rule-2--tofu-state-in-r2).

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
[`infra/app-state/cmd/menu-db-migrations/lint.go`](../infra/app-state/cmd/menu-db-migrations/lint.go)
scans `products/menu/drizzle/*.sql` for `DROP COLUMN` / `DROP TABLE`
/ `ALTER COLUMN ... TYPE` / `RENAME COLUMN` / `RENAME TABLE`. In
live mode, each destructive statement must carry an inline
`-- iedora:expand-contract phase=contract references=<expand-tag>`
marker (scoped to the same `--> statement-breakpoint` block) or the
configurator refuses to run. In local mode, violations log to
stderr but don't block. Tested via
[`lint_test.go`](../infra/app-state/cmd/menu-db-migrations/lint_test.go).

### 4. Stage 4 menu deploy is zero-downtime

`dockerOnHetzner.Deploy` must never stop the live container before its
replacement is healthy. The contract:

1. Pull image.
2. Start the incoming container as `infra-menu-web-next` on the
   `iedora` network.
3. HTTP-probe `/up` on the new container until 200 OK (Go-native, no
   `curl` shell-outs).
4. Atomically re-alias `infra-menu-web` (network alias swap, or Caddy
   upstream reload).
5. Stop + remove the old container.

Implemented in
[`infra/deploy/cmd/iedora/runtime_docker.go::dockerOnHetzner.deployHotSwap`](../infra/deploy/cmd/iedora/runtime_docker.go),
opted in by the `Healthcheck` field on the menu product literal in
[`products.go`](../infra/deploy/cmd/iedora/products.go). Tested via
[`runtime_docker_swap_test.go`](../infra/deploy/cmd/iedora/runtime_docker_swap_test.go)
(happy path, probe timeout, probe error, alias-swap failure, naive
fallback).

### 5. Zitadel reconciler — anti-panic lock

If a Zitadel resource exists on the live IdP but the corresponding
sync key is missing from BWS, the reconciler **fails loudly in `live`**
— never runs an automated `delete + recreate`.

Reason: protects against the cascade where a transient BWS API
timeout returns "key not found", the reconciler "recovers" by
re-creating live IAM resources, and live users / service accounts /
org structures are silently destroyed. Lookup failure is
operator-investigates territory, not auto-heal.

In `local` mode, the lock is off — delete+recreate is the normal
first-boot/reset behaviour.

**Escape hatch.** When a one-shot reveal is genuinely lost (audited
by the operator), pass `--allow-recreate=<resource>` to opt in
per-resource. Known tokens: `pat`, `target:menu-permissions`,
`target:menu-grants`. Each opt-in is single-resource — there's no
`--allow-recreate=all`.

Implementation: `guardRecreate` helper at
[`infra/app-state/cmd/zitadel-apply/reconcile.go`](../infra/app-state/cmd/zitadel-apply/reconcile.go),
gated at the PAT and action-target delete branches. Tested via
[`infra/app-state/cmd/zitadel-apply/reconcile_test.go`](../infra/app-state/cmd/zitadel-apply/reconcile_test.go).

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
 │ Hetzner  │               │ bin/zitadel-     │                 ├──► menu →
 │   VPS    │               │   apply          │                 │     dockerOnHetzner
 │          │               │                  │                 │     SSH + docker pull/run
 │ + CF DNS │               │ bin/menu-db-     │                 │     Serves BOTH
 │ + R2     │               │   migrations     │                 │     menu.iedora.com
 │ + GH cfg │               │                  │                 │     and iedora.com
 │ + compose│               │ bin/openobserve- │                 │     (proxy.ts rewrites
 │   stack  │               │   dashboards     │                 │      apex → /house/*)
 │   on box │               │                  │                 │
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
- BWS is the bus. Stage 3 writes Zitadel outputs + per-product app
  secrets; Stage 4 reads. No Tofu round-trips for app values.
- Stage isolation via SSH+localhost tunnels for internal-only services
  (`openobserve-dashboards` is the pattern reference).

## Stage 1 — Build & Test

Per-product. Owned by each product's CI workflow:

- **menu** (`.github/workflows/menu.yml`) — typecheck, lint, unit
  tests, E2E (Playwright), security scan, `docker buildx` (multi-arch:
  `linux/amd64` for CI + `linux/arm64` for the Hetzner CAX box) →
  `ghcr.io/<owner>/menu:<sha>` + SLSA build provenance attestation. On
  `main`, the workflow then triggers `deploy.yml` (Stage 4) with
  `product=menu` and `image_sha=<github.sha>`. Since the menu container
  serves BOTH `menu.iedora.com` and `iedora.com` (host-based rewrite
  in `src/proxy.ts`), one image deploy ships both sites.

The previous separate `house.yml` workflow + Astro + CF Workers Static
Assets deploy was retired when iedora.com was folded into the menu
Next.js app — see `products/menu/src/app/house/`.

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
  - `infra-postgres` (Postgres 18, menu + zitadel databases)
  - `infra-zitadel` + `infra-zitadel-login` (IdP)
  - `infra-caddy` (TLS termination, reverse proxy)
  - `infra-openobserve` (observability backend, bound to 127.0.0.1:5080)
  - `infra-pg-backup` (daily pg_dumpall → R2 GPG-encrypted)
- **Day-2 sync** ([sync.tf](../infra/iac/tofu/sync.tf)) — single
  `terraform_data` resource that SCPs `compose.yml` + `Caddyfile` to
  `/etc/iedora/` and restarts `iedora.service` when the compose hash
  changes.
- **Destroy-time R2 purge** ([destroy-hooks.tf](../infra/iac/tofu/destroy-hooks.tf))
  — `rclone purge` provisioners that empty the R2 buckets before the CF
  API DELETE (otherwise: 409 on non-empty bucket).
- **Random passwords minted by Tofu, written through to BWS** as
  `IAC_*` ([secrets.tf](../infra/iac/tofu/secrets.tf)) — postgres
  pwd, backup passphrase, zitadel masterkey, zitadel first-admin pwd,
  openobserve pwd. The Hetzner IPv4 also writes through here so Stage 3
  configurators can find the box.

**Does NOT own:**

- Zitadel app config (org, project, OIDC app, PAT, action targets) —
  Stage 3.
- The menu container — Stage 4 (`dockerOnHetzner`).
- DB migrations, OO dashboards — Stage 3.
- The menu session JWE secret — Stage 4 (`appSecrets`, minted on first
  deploy).

### Single-pass apply

`tofu apply` runs once with default parallelism. No `kreuzwerker/docker`
provider on the apply graph means no per-container SSH and no
MaxStartups concern. The only SSH on the graph is
`terraform_data.iedora_sync` — one session per compose/Caddyfile hash
change.

**Prerequisites on the operator's machine**: `tofu`, `bws`, `rclone`
(for destroy-time purge). All `brew install` away.

### State backend (R2)

State lives in the `iedora-tofu-state` R2 bucket via the OpenTofu
`s3` backend. One root today:

- `infra/iac/tofu/` → `infra/iac/tofu/terraform.tfstate`

(The previous per-product `products/house/infra/iac/tofu/` root was
retired when iedora.com moved into the menu Next.js app — no more CF
Workers Tofu plumbing.)

The state object is still encrypted at rest by Tofu's PBKDF2 +
AES-GCM `encryption {}` block (passphrase from
`IAC_BOOTSTRAP_STATE_PASSPHRASE`) — R2 only ever sees encrypted bytes.
Concurrent applies are gated by R2-native `use_lockfile = true` (a
sidecar `.tflock` object in the same bucket prefix).

The R2 bucket + scoped API token are out-of-band; they're minted by
`bin/state-bucket-bootstrap` (chicken/egg — Tofu can't manage the
bucket that stores its own state). See
[guardrails-implementation.md § Rule 2](./guardrails-implementation.md#rule-2--tofu-state-in-r2).

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

#### `zitadel-app-config` → [`bin/zitadel-apply`](../bin/zitadel-apply)

Reconciles the Zitadel IdP's application state via REST. Authenticates
with the FirstInstance-minted SA key (RSA JWT bearer, hand-rolled in Go
with `crypto/rsa` — no Zitadel SDK pulled in).

**Owns:** org `iedora`, project `iedora`, 6 project roles
(`iedora-admin`, `qr-codes:{read,write,update,delete,list}`), machine
user `menu-sa` + IAM_OWNER grant + long-lived PAT, OIDC app `menu`, 2
action targets (`menu-permissions`, `menu-grants`) + their function/
event executions, admin email grants.

**Health gate**: `tlsprobe.Wait` on `https://auth.iedora.com/debug/ready`
+ verifies the served cert is real Let's Encrypt (not Caddy's internal
CA).

**SA key bootstrap**: on cold runs, SSHes to the box and reads the
FirstInstance-minted JSON key from the `zitadel-bootstrap` named
volume, writes it to BWS. Subsequent runs find it in env (via
`with-secrets --stage app`).

**Outputs to BWS** (Stage 4 reads these):

| BWS key                                  | Source                              |
|------------------------------------------|-------------------------------------|
| `APP_ZITADEL_MENU_OIDC_CLIENT_ID`      | OIDC app create / search            |
| `APP_ZITADEL_MENU_OIDC_CLIENT_SECRET`  | Create or regenerate endpoint       |
| `APP_ZITADEL_MENU_SA_TOKEN`            | PAT create (one-shot reveal)        |
| `APP_ZITADEL_PERMISSIONS_SIGNING_KEY`  | action_target create (one-shot)     |
| `APP_ZITADEL_GRANTS_SIGNING_KEY`       | action_target create (one-shot)     |
| `APP_ZITADEL_IEDORA_PROJECT_ID`        | project create / search             |

**Recovery matrix** for one-shot-reveal values (PAT, signing keys).
Branch on `(BWS has, Zitadel has)`:

| BWS | Zitadel | Action                                                                    |
|-----|---------|---------------------------------------------------------------------------|
| no  | no      | Cold create, write BWS                                                    |
| yes | yes     | Trust BWS                                                                 |
| no  | yes     | **Delete + recreate** Zitadel resource, rebind executions, loud warning   |
| yes | no      | Drop stale BWS key, recreate cold, loud warning                           |

OIDC client_secret is regenerate-able (`POST .../oidc_config/_generate_client_secret`)
so its recovery is a single API call, not delete+recreate.

**Concurrent-operator guard**: bails on >1 PAT for `menu-sa`.
Operator reconciles via Zitadel UI before re-running.

**Subsumes** the legacy `zitadel-grant` binary via `--grants-only`.

#### `menu-db-migrations` → [`infra/app-state/menu-db-migrations`](../infra/app-state/menu-db-migrations/) (in-process)

drizzle-kit migrate against menu's postgres database. SSHes to the box,
runs `docker run --rm --network iedora -e DATABASE_URL=...
ghcr.io/<owner>/menu:<MENU_IMAGE_SHA> node scripts/migrate.mjs`.

The migrate script holds `pg_advisory_lock(727072073)` for
concurrent-deploy safety. Inputs: `MENU_IMAGE_SHA` env (default
"latest"), `hetzner_ipv4` + `menu_database_url` from `tofu output`
(nested `bin/iedora-env --stage iac` call — Stage 3's env scope
doesn't include the postgres password directly).

**docker login** before pull: Stage 3 runs with `IAC_BOOTSTRAP_GHCR_TOKEN`
in scope (universal), the binary `docker login ghcr.io
--password-stdin` before each pull.

**Why this is Stage 3 and not in Stage 4's `dockerOnHetzner`**: a bad
migration fails loud in the deploy log without crash-looping the live
menu container. Multi-replica future is also unblocked — migrations
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
policies on a future internal MinIO, additional Zitadel action targets
when new products land.

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
   `DEPLOY_MENU_SESSION_SECRET` on first deploy).
2. Resolve box IPv4 from `tofu output -raw hetzner_ipv4`.
3. Compose env from `envStatic` + `envFromBWS` (Stage 3 outputs +
   AUTOGEN secrets) + `envFromTofu` (DATABASE_URL, OTEL endpoint, S3
   creds, etc. — composed values from Tofu state).
4. SSH to box, `docker login ghcr.io`, `docker pull <image>:<sha>`.
5. `docker run -d --name infra-menu-web-next --network-alias
   infra-menu-web-next ...` — start the incoming container alongside
   the live one. Only the `-next` alias is bound, so Caddy keeps
   routing traffic to the OLD container.
6. Probe `docker exec infra-menu-web-next wget -qO- -T 5
   http://localhost:3000/up` every 500ms until the body contains
   `"ok":true` (60s budget). On timeout / failure: best-effort tear
   down `infra-menu-web-next` and surface the probe error — the live
   container is never touched.
7. Atomic cutover in one SSH command:
   `docker network disconnect iedora infra-menu-web &&
   docker network disconnect iedora infra-menu-web-next &&
   docker network connect --alias infra-menu-web --alias
   infra-menu-web-next iedora infra-menu-web-next`. Caddy resolves
   the upstream on every request (no in-network DNS cache), so the
   next request after this command lands on the new container.
8. Drain for `DrainDuration` (default 10s) — pure Go sleep, no shell
   sleep — so in-flight requests on the old container finish before
   SIGTERM.
9. `docker stop infra-menu-web && docker rm infra-menu-web` — reap
   the old container.
10. `docker rename infra-menu-web-next infra-menu-web` so the next
    deploy starts from the same naming baseline.

Rollback semantics: a failure at step 6 or 7 runs `docker stop / rm /
network disconnect` against the `-next` container only. The OLD
container — still bound to the live alias — keeps serving traffic.

**Inputs**:
- `MENU_IMAGE_SHA` env — set by CI (`github.sha`) or operator (export).
  Default "latest".
- `IAC_BOOTSTRAP_HOST_IP` — universal-scope BWS key, written by Stage 2.
- All `envFromBWS` keys — visible in `--stage deploy --product menu`
  scope.

**Caddy routing**: `infra-caddy` resolves `infra-menu-web` by docker
network alias. Between deploys (container stopped) it returns 502 —
correct behavior; restored as soon as Stage 4 lands.

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
4. `.github/workflows/<name>.yml` — copy menu.yml, swap names.
   Dispatches the reusable
   [`deploy.yml`](../.github/workflows/deploy.yml) workflow with
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
| `IAC_*`             | Tofu (Stage 2)      | `IAC_POSTGRES_PASSWORD`, `IAC_BACKUP_PASSPHRASE`, `IAC_ZITADEL_MASTERKEY`                          |
| `APP_<service>_*`   | Stage 3 configurator| `APP_ZITADEL_MENU_OIDC_CLIENT_ID`, `APP_ZITADEL_MENU_SA_TOKEN`, `APP_ZITADEL_PERMISSIONS_SIGNING_KEY` |
| `DEPLOY_<product>_*`| Stage 4 productRuntime | `DEPLOY_MENU_SESSION_SECRET`                                                                  |

The prefix tells you who writes the value — which means it also tells
you where to look when it goes wrong and which `--stage` will surface
it. Rotation playbooks for each prefix are in § Secret rotation below.

| Stage  | Visible BWS keys                                                                                                                |
|--------|---------------------------------------------------------------------------------------------------------------------------------|
| iac    | Provider creds (Hetzner, CF, GH), state passphrase, all IAC_*, OO email/password                                      |
| app    | IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON, IAC_BOOTSTRAP_GHCR_TOKEN (for menu-db-migrations pulls), OO email/password (dashboards Basic auth), universal keys |
| deploy | Universal + CF/state (for per-product Tofu) + IAC_BOOTSTRAP_GHCR_TOKEN (docker pull) + per-product extras gated by `--product`          |

Per-product extras for `--product menu`: the 6 `APP_ZITADEL_MENU_*`
keys + `DEPLOY_MENU_SESSION_SECRET`.

TF_VAR_* aliases auto-emitted only for stages that use Tofu (iac,
deploy). App stage doesn't get TF_VARs.

Tests at
[`infra/deploy/cmd/iedora/env_test.go`](../infra/deploy/cmd/iedora/env_test.go)
cover every stage path.

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
bin/iedora-env bin/zitadel-apply --grants-only              # Just the iedora-admin grants.

# Stage 4 — Deploy
bin/iedora-env bin/iedora deploy menu                       # Menu.
bin/iedora-env bin/iedora deploy house                      # House.
bin/iedora-env bin/iedora destroy menu                      # Tear down menu's stage-4 artifacts.

# Local dev stack
go run ./dev/cmd/local-stack                            # Boot.
go run ./dev/cmd/local-stack --destroy                  # Wipe.
go run ./dev/cmd/local-stack --reset-db menu            # Drop+recreate one DB.

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
| [`infra-deploy.yml`](../.github/workflows/infra-deploy.yml) | 2 | push to main on `infra/iac/**`, `internal/**`, `bin/{bws-sync,bws-upsert,state-bucket-bootstrap}`, `go.{mod,sum}`. Manual dispatch. |
| [`app-state.yml`](../.github/workflows/app-state.yml)       | 3 | `workflow_run` on infra-deploy success. Also: push on `infra/app-state/cmd/zitadel-apply/**`, `infra/app-state/cmd/menu-db-migrations/**`, `infra/app-state/cmd/openobserve-dashboards/**`. Manual dispatch. |
| [`menu.yml`](../.github/workflows/menu.yml)                 | 1+4 | push to main on `products/menu/**`. Build + push image (multi-arch), then dispatches `deploy.yml(product=menu, sha=...)`. Ships both menu.iedora.com AND iedora.com. |
| [`deploy.yml`](../.github/workflows/deploy.yml)             | 4 | reusable `workflow_call` invoked by `menu.yml`. Generic over `product`. |

Every workflow runs commands under `bin/iedora-env` so CI sees the same
hydrated BWS env operators do — that helper exports the `TF_VAR_*`,
`AWS_*`, and `CLOUDFLARE_ACCOUNT_ID` aliases everything downstream
expects.

State commit-back: both `infra-deploy.yml` and the per-product Tofu
side of `deploy.yml` commit the encrypted `terraform.tfstate` back to
`main` after a successful apply — git stays canonical.

## Local stack (`go run ./dev/cmd/local-stack`)

[`dev/docker-compose.yml`](../dev/docker-compose.yml)
is the source of truth for the local stack shape: postgres,
localstack (S3 mock), openobserve, zitadel + login UI, house, menu.
Each service is gated by a compose profile matching its name.

[`dev/cmd/local-stack/`](../dev/cmd/local-stack/) is a thin Go shim that:

1. Translates `--only`/`--except` into compose profile flags.
2. `docker compose up -d --wait` for everything except menu.
3. Waits for Zitadel `/debug/ready` (no docker healthcheck — the
   image is distroless, no shell to run one).
4. Runs `bin/zitadel-apply --mode local --output-file
   dev/.zitadel-bootstrap/outputs.json` against
   `localhost:8080`. The SA key is `docker cp`'d out of the
   `zitadel_bootstrap` named volume.
5. Composes `products/menu/.env` from local-stack statics +
   outputs.json + a minted session secret (persisted alongside the
   outputs).
6. `docker compose up -d menu` — the menu container's `env_file:`
   picks up the just-written `.env`.

Menu runs as a container by default (same image as prod). For HMR,
opt out via `go run ./dev/cmd/local-stack --except menu` and `cd products/menu && bun
run dev` — the orchestrator drops the in-container env values and
writes `<please_fill>` placeholders into `.env.local` for the
operator to point at remote URLs.

`go run ./dev/cmd/local-stack --only menu` brings up menu's deps (postgres, localstack,
openobserve, zitadel) too via the dep closure in the orchestrator.
`go run ./dev/cmd/local-stack --reset-db -- <name>` drops + recreates one database.

## Day-2 operations

Most day-2 work is SSH against the box. Resolve the host once and re-use:

```bash
HOST=$(bin/iedora-env --stage iac -- tofu -chdir=infra/iac/tofu\1output -raw hetzner_ipv4)

# Logs
ssh root@$HOST docker logs -f --tail=200 infra-zitadel        # or infra-menu-web / infra-caddy / …

# psql
ssh -t root@$HOST docker exec -it infra-postgres psql -U postgres

# Force a pg_dump now
ssh root@$HOST docker exec infra-pg-backup /infra-pg-backup backup

# Restore latest dump
ssh -t root@$HOST docker exec -it infra-pg-backup /infra-pg-backup restore

# Open the OpenObserve UI via SSH tunnel (OO is internal-only)
ssh -L 5080:localhost:5080 root@$HOST   # then open http://localhost:5080
```

### Secret rotation

| Secret kind | How to rotate |
|-------------|---------------|
| `IAC_BOOTSTRAP_*` (HCLOUD, CF, GH, GHCR, etc.) | Regenerate at the source provider, then `bws secret edit <id>` with the new value. |
| `IAC_*` (Tofu-minted) | `bin/iedora-env --stage iac -- tofu -chdir=infra/iac/tofu\1apply -replace=random_password.<name>`. The `terraform_data.bws_sync_autogen` write-through pushes the new value to BWS automatically. |
| `APP_ZITADEL_MENU_SA_TOKEN` | `bws secret delete <id>`, then `bin/iedora-env bin/iedora app apply` — zitadel-apply detects `(no BWS, yes Zitadel)`, deletes the live PAT, mints a new one, writes BWS. Menu container restarts on next `bin/iedora-env bin/iedora deploy menu`. |
| `DEPLOY_MENU_SESSION_SECRET` | `bws secret delete <id>`, then `bin/iedora-env bin/iedora deploy menu`. `dockerOnHetzner.appSecrets` re-mints. All active sessions invalidate (users re-auth). |
| `IAC_ZITADEL_MASTERKEY` | **Don't rotate casually.** It encrypts Zitadel's projection table — re-keying mid-flight is unsupported. To actually rotate: `TF_VAR_allow_masterkey_rotation=true bin/iedora-env tofu -chdir=infra/iac/tofu apply` (one-time override on the prevent_destroy lifecycle guard), then a Zitadel rebootstrap (see below). |

### Zitadel rebootstrap (cold-start Zitadel without losing the rest)

If Zitadel's state is corrupt or the masterkey rotated:

```bash
# Drop the live PAT + signing keys from BWS so the reconciler treats this as cold
for K in IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON \
         APP_ZITADEL_MENU_OIDC_CLIENT_ID APP_ZITADEL_MENU_OIDC_CLIENT_SECRET \
         APP_ZITADEL_MENU_SA_TOKEN APP_ZITADEL_PERMISSIONS_SIGNING_KEY \
         APP_ZITADEL_GRANTS_SIGNING_KEY APP_ZITADEL_IEDORA_PROJECT_ID; do
  bws secret delete "$(bws secret list -o json | jq -r ".[]|select(.key==\"$K\")|.id")"
done

# Recreate the container + drop its database
ssh root@$HOST docker rm -f infra-zitadel infra-zitadel-login
ssh root@$HOST docker exec infra-postgres psql -U postgres -c "DROP DATABASE zitadel WITH (FORCE); CREATE DATABASE zitadel;"
ssh root@$HOST docker volume rm zitadel-bootstrap

# Re-apply infra (recreates the container, FirstInstance re-runs)
bin/iedora-env tofu -chdir=infra/iac/tofu apply
bin/iedora-env bin/iedora app apply        # fetches the fresh SA key, reconciles org/project/PAT/etc. cold
bin/iedora-env bin/iedora deploy menu      # restart menu with the new OIDC client_secret + PAT
```

### Backups

`infra-pg-backup` runs the Go binary
[`infra/backup`](../infra/iac/cmd/infra-pg-backup/) in daemon
mode on `SCHEDULE=@daily`: `pg_dumpall` every database on
`infra-postgres` → R2 (`iedora-data` bucket, `pg/` prefix),
GPG-encrypted with `IAC_BACKUP_PASSPHRASE`. The S3 client is
the pure-Go SigV4 implementation at [`internal/r2`](../internal/r2);
no `aws` CLI in the image.

Restore: `ssh -t root@$HOST docker exec -it infra-pg-backup /infra-pg-backup restore`.

Retention: 14 days (`BACKUP_KEEP_DAYS=14`).

**Don't rotate `IAC_BACKUP_PASSPHRASE` casually** —
previously-encrypted dumps become unreadable. Pre-launch this is
acceptable; post-launch use a dual-passphrase window.

## Bootstrap (cold from scratch)

First-time setup on a fresh laptop + empty cloud:

1. **Local tools**: `brew install opentofu gh go-task bitwarden/tap/bws`,
   Docker Desktop or OrbStack, `gh auth login` with `write:packages`.
2. **Cloudflare API token** at dash.cloudflare.com → API Tokens:
   - Account · Account Settings · Read
   - Account · Workers R2 Storage · Edit
   - Zone · DNS · Edit (scoped to your zone)
   - User · API Tokens · Edit (Tofu mints sub-tokens)
3. **SSH key**: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519` if
   you don't have one. Tofu registers `~/.ssh/id_ed25519.pub` as
   `hcloud_ssh_key.operator`.
4. **Populate BWS** — only `BWS_ACCESS_TOKEN` needs to be in your shell
   (e.g. `export BWS_ACCESS_TOKEN=0.…` in `~/.secrets`). Then:

   ```bash
   PROJECT_ID=$(bws project list -o json | jq -r '.[]|select(.name=="iedora-deploy")|.id')
   for KEY in IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN IAC_BOOTSTRAP_STATE_PASSPHRASE \
              IAC_BOOTSTRAP_HCLOUD_TOKEN IAC_BOOTSTRAP_GITHUB_API_TOKEN IAC_BOOTSTRAP_GHCR_TOKEN \
              IAC_BOOTSTRAP_SSH_PRIVATE_KEY IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN \
              IAC_BOOTSTRAP_OPENOBSERVE_ROOT_USER_EMAIL; do
     read -s -p "$KEY: " V && echo
     bws secret create "$KEY" "$V" "$PROJECT_ID" -o none
   done
   ```

   Source-of-truth notes:
   - `IAC_BOOTSTRAP_STATE_PASSPHRASE`: `openssl rand -hex 32` — encrypts Tofu state.
   - `IAC_BOOTSTRAP_HCLOUD_TOKEN`: Hetzner console → Security → API tokens (R/W).
   - `IAC_BOOTSTRAP_GITHUB_API_TOKEN`: fine-grained PAT scoped to the repo
     (Actions r/w, Secrets r/w, Variables r/w, Contents r).
   - `IAC_BOOTSTRAP_GHCR_TOKEN`: classic PAT with `write:packages` (fine-
     grained + personal account + GHCR is GitHub's worst-supported
     combo — keep classic until iedora moves to an org).
   - `IAC_BOOTSTRAP_SSH_PRIVATE_KEY`: `cat ~/.ssh/id_ed25519`.
   - `IAC_BOOTSTRAP_CLAUDE_CODE_OAUTH_TOKEN`: `claude setup-token`.

   The 5 `IAC_*` keys are minted by Tofu on first apply — DO
   NOT populate them.

5. **Run the pipeline**: `bin/iedora-env bin/iedora doctor && bin/iedora-env tofu -chdir=infra/iac/tofu apply`. First time: 5–10
   min. Validate `https://menu.iedora.com/up` returns
   `{"ok":true,"db":"ok"}`.

## Failure modes / troubleshooting

The ones operators are likely to hit. Most are recoverable by re-running
the affected stage; the rest have explicit recovery steps below.

### Tofu apply / destroy

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `Error: error during placement (resource_unavailable, ...)` on `hcloud_server.iedora` | Hetzner datacenter (default `fsn1`) is temporarily out of capacity for the chosen SKU (e.g. CAX11). | Wait 5–10 min, OR pass `TF_VAR_hetzner_location=nbg1` (Nuremberg) or `hel1` (Helsinki) — same EU backbone, similar latency from PT. Validated tier list in `variables.tf::hetzner_location`. |
| `Error acquiring the state lock` (HTTP 412 `PreconditionFailed`) | Previous `tofu apply` was Ctrl-C'd before releasing the R2-backend lock. Lock ID + path are in the error body. | `bin/iedora-env tofu -chdir=infra/iac/tofu force-unlock -force <LOCK_ID>`. Safe when you know the prior operation is dead (the error shows `Who:` so you can confirm). |
| `Resource instance random_password.zitadel_masterkey has prevent_destroy set` on `tofu destroy` | The masterkey lifecycle guard (encrypts Zitadel's projection table — rotating it bricks state) blocks all destroys by default. | One-shot override: `TF_VAR_allow_masterkey_rotation=true bin/iedora-env tofu -chdir=infra/iac/tofu destroy`. Don't leave the var set after. |
| `tofu destroy` reports `0 destroyed` but the Hetzner box / CF DNS / R2 buckets still exist | A previous `tofu apply` was cancelled mid-run; resources were created on the provider side but never persisted to the state file. State is empty so destroy has nothing to do. | Cleanup via API directly. Inventory: `curl ... https://api.hetzner.cloud/v1/servers`, `curl ... /accounts/$AID/r2/buckets`, `curl ... /zones/$ZID/dns_records`. Delete by ID. |
| Destroy fails: bucket DELETE returns 409 / hangs | `rclone purge` skipped (binary missing or no creds) and the R2 bucket has objects. | `brew install rclone` if missing. Re-run destroy. If buckets stay, manually `rclone purge :s3:<bucket>` with `RCLONE_S3_*` env (see `destroy-hooks.tf`). |
| `bin/iedora-env` aborts with `RSA: command not found` on tempfile line N | Older versions of iedora-env sourced `bws secret list -o env` directly; multi-line values (SSH private key) break bash quoting. | Pull latest; the helper now reads JSON + base64-decodes per key. If still hitting: `git pull && rm -rf node_modules` + re-test. |

### Stage 2 — infra (Hetzner / Cloudflare)

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `iedora.service failed because the control process exited with error code` after first apply, log says `service "X" refers to undefined volume "Y": invalid compose project` | HCL volume map key (e.g. `caddy_data`) doesn't match the name referenced in the service's `volumes` list (e.g. `caddy-data`). yamlencode emits keys verbatim. | Quote hyphenated keys in `compose.tf::local.compose.volumes` — `"caddy-data" = { name = "caddy-data" }` — so the key matches the service reference. |
| All containers restart on a small env change | Older `iedora.service` ran `systemctl restart` which fires `ExecStop = docker compose down` → `ExecStart` (full down/up). | Pull latest. The unit now has `ExecReload = docker compose up -d --remove-orphans` and `sync.tf` calls `systemctl reload` instead of restart — only containers whose config actually changed are recreated. |
| Caddy still serves old routing after a Caddyfile edit | The Caddyfile is bind-mounted; changing it on the host doesn't trigger a container restart, and the caddy daemon caches its config in memory. | `sync.tf` now runs `docker exec infra-caddy caddy reload --config /etc/caddy/Caddyfile` after the file push. If you bypassed sync: `ssh root@$HOST docker exec infra-caddy caddy reload --config /etc/caddy/Caddyfile`. |
| BWS destroy hooks report `429 Too Many Requests` and leave 1–2 IAC_* keys behind | BWS mutating-call rate limit is ~1/s server-side. Older code fired N parallel `terraform_data.bws_sync_*` provisioners and saturated it. | Pull latest. `bws-sync` (single resource, sequential batch) replaces the per-key resources. If a key still lingers: `BWS_PROJECT_ID=... BWS_KEY=<key> BWS_DELETE=1 bin/bws-upsert`. |

### Stage 3 — app state

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `Host key verification failed` from a configurator's SSH call | Operator's `~/.ssh/known_hosts` pins a stale key for the Hetzner IP (recycled across destroy/apply). | `internal/ssh.Client` uses `UserKnownHostsFile=/dev/null + StrictHostKeyChecking=no` — pull latest. For ad-hoc `ssh root@$HOST` from the laptop: `ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@$HOST`. |
| `x509: certificate signed by unknown authority` from `tlsprobe` after Zitadel ready | Caddy served `/debug/ready` via its internal CA while Let's Encrypt's ACME challenge was still mid-flight. | `tlsprobe.probeCertIssuer` rejects "Caddy Local Authority"; budget is 6m. If exhausted: `ssh root@$HOST docker logs infra-caddy` for LE rate-limit / firewall issues. |
| `Errors.Target.DeniedURL` on action-target create | Zitadel's URL validator can't resolve `menu.iedora.com` from inside the iedora docker network. | `zitadel-apply` runs `waitForMenuDNS` before creating action targets — 90s budget. Increase if it fires. |
| `found N PATs on machine user "menu-sa" (expected 0 or 1)` | Prior run crashed mid-create OR two operators raced. Concurrent guard refuses to silently delete the wrong one. | Reconcile via Zitadel UI; re-run `bin/iedora-env bin/iedora app apply`. |
| `menu-db-migrations: connection refused` | `infra-postgres` isn't up. | `ssh root@$HOST docker ps`. If missing, `bin/iedora-env tofu -chdir=infra/iac/tofu apply`. |

### Stage 4 — deploy

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `BWS missing APP_ZITADEL_*` | Stage 3 didn't complete. | `bin/iedora-env bin/iedora app apply` first. |
| `tofu output X empty` | Stage 2 wasn't run, OR an `outputs.tf` entry was added but not applied. | `bin/iedora-env tofu -chdir=infra/iac/tofu apply`. |
| `unauthorized` from `docker pull ghcr.io/...` | `IAC_BOOTSTRAP_GHCR_TOKEN` expired OR not in scope. | Regenerate the GHCR PAT, `bws secret edit`. The configurator's `docker login` step uses `--password-stdin` so the token never appears in `docker history`. |
| `Type 'string \| undefined' is not assignable to parameter of type 'string'` in `proxy.ts` during `next build` | `noUncheckedIndexedAccess` is on; `(host ?? '').split(':')[0]` is `string \| undefined`. | `… .split(':')[0] ?? ''`. Or any guard before `houseHosts.has(host)`. |
| `iedora.com` / `menu.iedora.com` → 502 from Caddy | Caddy is up but `infra-menu-web` upstream isn't running (Stage 4 didn't deploy, or container crashed). | `ssh root@$HOST docker ps` — confirm `infra-menu-web` listed. If missing: `bin/iedora-env bin/iedora deploy menu`. |
| Hot-swap window (~150ms) where `menu.iedora.com` 502s mid-deploy | The brief alias-unbind during `docker network disconnect/connect`. | Retry the request; the alias rebinds within the second. If persistent: both `infra-menu-web` and `infra-menu-web-next` running means the rename never landed — rename manually. |

### CI

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `App state (Stage 3)` workflow fails with `Error loading key "/home/runner/.ssh/id_ed25519": error in libcrypto`, `SSH_KEY:` line is empty in the env dump | `tofu destroy` removed the `github_actions_secret.secrets` resources Tofu had written — `IAC_BOOTSTRAP_SSH_PRIVATE_KEY` and `BWS_ACCESS_TOKEN` are gone from the repo. | Expected after a `tofu destroy`. Either: (a) `bin/iedora-env tofu -chdir=infra/iac/tofu apply` rewrites them on next apply, (b) set manually with `gh secret set <NAME> --repo eduvhc/iedora`, or (c) ignore — next real deploy fixes it. |
| `menu.yml` E2E run hangs / fails after long re-arrangement | Stale CI cache (e.g. node_modules, Playwright browsers) confused by a workspaces refactor. | Re-run the workflow with `gh run rerun <run-id> --failed`. If still red: bump the cache key or delete the cache via the Actions UI. |

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
bin/iedora-env tofu -chdir=infra/iac/tofu console <<< 'nonsensitive(local.caddyfile)'
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
curl -sI https://auth.iedora.com/debug/ready | head -1   # → HTTP/2 200
```

**Catches**: cloud-init failures (missing packages, bad write_files
indent), provider quirks, the `terraform_data.iedora_sync` SSH push
working at all, Let's Encrypt cert issuance, the docker-compose YAML
actually being valid (this only fires on `docker compose up` on the
box — `tofu plan` doesn't run compose).

### Layer 2.5 — Warm apply (idempotency, < 1 min)

```bash
bin/iedora-env tofu -chdir=infra/iac/tofu apply
```

Immediately re-run. Expected: `Apply complete! Resources: 0 added, 0
changed, 0 destroyed.`

**Catches**: non-deterministic `yamlencode` ordering, unstable
`triggers_replace` hashes (compose, Caddyfile, systemd unit). If
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
# postgres, zitadel, caddy, openobserve should preserve their uptime.
ssh root@$HOST 'docker ps --format "{{.Names}}\t{{.RunningFor}}"'
```

**Catches**: regressions where a small config change bounces the
whole stack (the `systemctl reload` vs `restart` finding — see
`sync.tf`). Catches Caddyfile bind-mount changes not propagating
without an explicit `caddy reload`.

### Layer 4 — Destroy (~3 min, frees all paid resources)

```bash
TF_VAR_allow_masterkey_rotation=true \
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
`infra/deploy/cmd/iedora/`, `infra/app-state/cmd/zitadel-apply/`, the other Stage 3
binaries, `infra/iac/tofu/*.tf`, `internal/*`, `bin/*`,
`products/menu/**` (which now also hosts iedora.com), or `infra/iac/**/*.tf`). The sequence proves
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
catches the DNS race inside `zitadel-apply` (between
`cloudflare_dns_record.menu_iedora` create and `zitadel_action_target`
create) and the OO dashboards' tunnel-then-reconcile flow on a fresh
target.

**One failed step ⇒ do not merge.**

### What each step asserts

| Step | What it proves |
|------|----------------|
| 1. destroy | `tofu destroy` works from any state. R2 buckets emptied via rclone hooks; BWS keys scrubbed via `bin/bws-sync` batched destroy. |
| 2. cold deploy | Full bootstrap: 26 Tofu resources, all 3 configurators run cold, menu deploys (serves both menu.iedora.com AND iedora.com). |
| 3. warm deploy | Idempotency at every stage. Stage 2: `0 added, 0 changed, 0 destroyed`. Stage 3: all "updated" or "no diff". Stage 4: re-pull same SHA → no container restart. |
| 4. destroy (full) | R2 emptying works against real R2 (rclone). |
| 5. cold deploy #2 | DNS gate inside zitadel-apply fires correctly. PAT/signing-key recovery matrix works. |
| 6. warm deploy | Final no-op. |

### Expected state after a cold deploy

- **Tofu state** (`infra/iac/tofu/`): ~26 resources (hcloud VPS/firewall/key, cloudflare R2/DNS/api_tokens incl. iedora.com apex + www, github_actions_secret/variable, random_password.*, terraform_data.{bws_sync,iedora_sync,data_bucket_purge,assets_bucket_purge}).
- **BWS**: 6 `APP_ZITADEL_*` outputs from Stage 3 + `DEPLOY_MENU_SESSION_SECRET` minted by Stage 4 + `IAC_BOOTSTRAP_HOST_IP` + 5 autogen passwords from `bws_sync`.
- **Zitadel**: org `iedora`, project `iedora`, 6 roles, machine user `menu-sa` with 1 PAT + IAM_OWNER, OIDC app `menu`, 2 action targets with executions.
- **Box** (`ssh root@$HOST docker ps`): `infra-postgres`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `infra-openobserve`, `infra-pg-backup` (compose-managed via `iedora.service`) + `infra-menu-web` (Stage-4-owned, NOT in compose).
- **Public endpoints**:
  - `https://menu.iedora.com/up` → 200 `{"ok":true,"db":"ok"}`
  - `https://auth.iedora.com/.well-known/openid-configuration` → 200
  - `https://iedora.com` → 200 (house landing — served by menu container via `proxy.ts` Host rewrite)

## File map

```
bin/                                     `go run` / `bash` shims operators invoke directly
  iedora                                   → infra/deploy/cmd/iedora
  with-secrets                             → deploy/with-secrets
  state-bucket-bootstrap                   → iac/cmd/state-bucket-bootstrap (Stage -1)
  zitadel-apply                            → infra/app-state/cmd/zitadel-apply
  menu-db-migrations                       → app-state/menu-db-migrations
  openobserve-dashboards                   → app-state/openobserve-dashboards
  bws-upsert                               → infra/iac/cmd/bws-upsert (Tofu local-exec helper)

deploy/                                  Stage 2/3/4 orchestrator + helpers
  iedora/                                  orchestrator: subcommands + runtime registry
    main.go, iac.go, app.go, deploy.go, pipeline.go, doctor.go, destroy.go
    runtime.go, runtime_docker.go, runtime_cf.go     productRuntime + 2 impls
    configurators.go                                 Stage 3 registry
    products.go                                      Stage 4 registry
    ssh.go, tofu.go, paths.go, log.go
  with-secrets/                            BWS wrapper. main.go + env.go + env_test.go
  state-bucket-bootstrap/                  Stage -1 — R2 bucket + scoped token for the
                                           Tofu s3 backend (chicken/egg helper)

app-state/                               Stage 3 — each subdir is a self-contained configurator
  zitadel/                                 Zitadel REST reconciler (org / project / OIDC /
                                           machine user + PAT / action targets / grants)
  menu-db-migrations/                      drizzle-kit migrate via SSH + docker run
  openobserve-dashboards/                  SSH-L tunnel + go:embed JSONs + REST upsert

internal/                                Shared Go helpers (repo-root single Go module)
  bws/                                     bws CLI wrapper (ProjectID, ListSecrets, Find, Upsert, Delete)
  cloudflare/                              CF /accounts API + R2 S3 creds derivation
  mode/                                    binary-mode enum (local vs live; Guardrail #1)
  r2/                                      R2 S3 client (EmptyBucket for destroy)
  tlsprobe/                                `Wait()` for /debug/ready + LE-cert-not-Caddy-internal
  testfakes/                               test-only HTTP server fakes

infra/                                   Stage 2 — IaC for the shared estate
  iac/
    tofu/                                  central Tofu root
      versions.tf, variables.tf, hetzner.tf, main.tf, compose.tf,
      sync.tf, destroy-hooks.tf, secrets.tf, github.tf, outputs.tf
      templates/{Caddyfile,cloud-init.yml,iedora.service}
    cmd/
      bws-sync/                            Batched BWS write/delete (Tofu local-exec entry point)
      bws-upsert/                          Single-key variant (ad-hoc)
      infra-pg-backup/                     Postgres-backup container (Go + Dockerfile, arm64)
      state-bucket-bootstrap/              Stage -1 — R2 bucket + token bootstrap
    postgres/                              init.sql — CREATE DATABASE menu / zitadel on first boot

dev/                                     Local stack (mirror of Stages 2-4)
  docker-compose.yml, localstack-init.sh   the stack itself
  orchestrator/                            Go binary driving compose + the Stage-3-equivalent
                                           seed step (replaces the prior Tofu-for-dev root)
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
  CRUD-with-stable-IDs — Tofu's wheelhouse. App-level APIs (Zitadel,
  OpenObserve, drizzle migrate) are imperative, often have one-shot
  reveals (PAT, signing keys), and need ordering across resources. The
  Zitadel TF provider's plan-time `Configure()` failure, the
  HTTPS_PROXY DNS-override sidecar we used to need, the 3-pass
  deploy dance with placeholder auth modes — all symptoms of forcing
  app state through Tofu. A bespoke reconciler that knows the app's
  quirks is better here.

- **Stage isolation matches blast radius.** A bug in
  `bin/zitadel-apply` can't touch Tofu state. A typo in
  `products/menu/src/app/house/page.tsx` only affects the iedora.com
  landing — the menu app still ships. Each stage is independently
  runnable for surgical re-rolls (`bin/iedora-env bin/iedora app apply
  --only menu-db-migrations`).

- **Adding products + configurators is mechanical.** New product =
  struct literal + 1 workflow file. New Stage 3 configurator = struct
  literal + 1 binary. No orchestrator code changes.

- **BWS as the bus** means no Tofu round-trips for app values. Stage 3
  writes outputs; Stage 4 reads them directly. The encrypted Tofu state
  is canonical for infra; BWS is canonical for app state.

The trade-off: re-implementing CRUD against ~10 Zitadel REST endpoints
(~2000 LOC of Go vs ~430 LOC of Tofu). Worth it given the operational
pain the Tofu-managed Zitadel inflicted.
