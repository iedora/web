# Iedora — Infrastructure, App State, and Deploy

> One doc, end-to-end. Architecture + commands + ops in one place. If
> something contradicts this, this wins — it's the only deploy doc.

## The pipeline

Four stages. Each runs independently and is idempotent. Locally:
[Taskfile](../Taskfile.yml). In CI: per-stage workflows under
[.github/workflows/](../.github/workflows/) that wrap the same `task`
recipes.

```
Stage 1: Build & Test      per-product (bun, docker build, tests)
Stage 2: IaC               task infra:up    → tofu apply on infra/tofu/
Stage 3: App state         task app:apply   → configurator registry
Stage 4: Deploy            task deploy:<p>  → per-product runtime
```

`task up` chains 2 → 3 → 4.

**Hard split**: Tofu owns infrastructure ONLY — VPS, Cloudflare, GitHub
config, Docker network, the *shared service containers*. Anything that
lives **inside** a running service (Zitadel org/project/PAT, drizzle
migrations on postgres, OpenObserve dashboards, the menu app container)
is **not** in Tofu. App state belongs to Stage 3 (configurators) and
Stage 4 (per-product deploys).

## Architecture

```
                            ┌──────────────────┐
                            │   operator        │
                            │   $ task up       │
                            └────────┬──────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
 ┌──────────┐               ┌──────────────┐              ┌──────────────┐
 │ STAGE 2  │               │  STAGE 3     │              │   STAGE 4    │
 │   IaC    │  ───── then ──┤  AppState    │ ─── then ────│   Deploy     │
 │          │               │              │              │              │
 │ task     │               │ task         │              │ task         │
 │ infra:up │               │ app:apply    │              │ deploy:all   │
 └────┬─────┘               └──────┬───────┘              └──────┬───────┘
      │                            │                             │
      │ tofu apply                 │ walks                       │ fans out
      │  on infra/tofu/            │ appConfigurators            │ over
      ▼                            ▼                             │ products[]
 ┌──────────┐               ┌──────────────────┐                 │
 │ Hetzner  │               │ bin/zitadel-     │                 ├──► menu →
 │   VPS    │               │   apply          │                 │     dockerOnHetzner
 │          │               │                  │                 │     SSH + docker pull/run
 │ + CF DNS │               │ bin/menu-db-     │                 │
 │ + R2     │               │   migrations     │                 ├──► house →
 │ + GH cfg │               │                  │                 │     cloudflareWorker
 │ + Docker │               │ bin/openobserve- │                 │     bun build + per-product
 │   net +  │               │   dashboards     │                 │     tofu apply
 │   shared │               │                  │                 │
 │   ctrs   │               │                  │                 ├──► <future>
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
  tests, E2E (Playwright), security scan, `docker buildx` →
  `ghcr.io/<owner>/menu:<sha>` + SLSA build provenance attestation.
  On `main`, the workflow then triggers `deploy.yml` (Stage 4) with
  `product=menu` and `image_sha=<github.sha>`.
- **house** (`.github/workflows/house.yml`) — a thin trigger that
  dispatches `deploy.yml` with `product=house`. The actual build (`bun
  run build`) runs INSIDE `task deploy:house` since house's runtime
  (`cloudflareWorker`) bundles build + apply.

Local: `bun run typecheck`, `bun run test`, `bun run build` per
product. The Taskfile doesn't have a `build` stage because each product
already has its own conventions.

## Stage 2 — IaC (`task infra:up`)

`tofu apply` on [`infra/tofu/`](../infra/tofu/). Owns:

- **Hetzner VPS, firewall, SSH key** ([hetzner.tf](../infra/tofu/hetzner.tf))
- **Cloudflare** R2 buckets, DNS records, scoped API tokens
  ([main.tf](../infra/tofu/main.tf))
- **GitHub Actions config** — secrets + variables on the repo, via the
  `integrations/github` provider ([github.tf](../infra/tofu/github.tf))
- **Docker network + named volumes** + **shared service containers**
  ([containers.tf](../infra/tofu/containers.tf)):
  - `infra-postgres` (Postgres 18, menu + zitadel databases)
  - `infra-zitadel` + `infra-zitadel-login` (IdP)
  - `infra-caddy` (TLS termination, reverse proxy)
  - `infra-openobserve` (observability backend, bound to 127.0.0.1:5080)
  - `infra-backups` (daily pg_dumpall → R2 GPG-encrypted)
- **Random passwords minted by Tofu, written through to BWS** as
  `IAC_*` ([secrets.tf](../infra/tofu/secrets.tf)) — postgres
  pwd, backup passphrase, zitadel masterkey, zitadel first-admin pwd,
  openobserve pwd.

**Does NOT own:**

- Zitadel app config (org, project, OIDC app, PAT, action targets) —
  Stage 3.
- The menu container — Stage 4 (`dockerOnHetzner`).
- DB migrations, OO dashboards — Stage 3.
- The menu session JWE secret — Stage 4 (`appSecrets`, minted on first
  deploy).

### Two-pass apply

`iedora iac apply` runs Tofu in two passes:

1. **Pass 1**: targeted `tofu apply` of `hcloud_ssh_key`,
   `hcloud_firewall`, `hcloud_server`, `null_resource.docker_ready`.
   The `kreuzwerker/docker` provider needs an IP at plan time; this
   provisions the box first. Then `ssh-keyscan` to pre-populate
   `~/.ssh/known_hosts` for the docker provider's SSH calls.
2. **Pass 2**: full apply. All shared containers + CF + GH config.

The 2-pass dance is INTERNAL — operator just runs `task infra:up`. On
warm runs both passes are no-diff refreshes (~3s each).

### Encrypted state

`infra/tofu/terraform.tfstate` is encrypted at rest (PBKDF2 +
AES-GCM). Passphrase from BWS key `IAC_BOOTSTRAP_STATE_PASSPHRASE`. CI commits
the encrypted state back to `main` after every successful apply so the
next run starts from canonical state.

## Stage 3 — App state (`task app:apply`)

Walks the configurator registry in
[`infra/cmd/iedora/configurators.go`](../infra/cmd/iedora/configurators.go).
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

#### `zitadel-app-config` → [`bin/zitadel-apply`](../infra/bin/zitadel-apply)

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

#### `menu-db-migrations` → [`bin/menu-db-migrations`](../infra/bin/menu-db-migrations)

drizzle-kit migrate against menu's postgres database. SSHes to the box,
runs `docker run --rm --network iedora -e DATABASE_URL=...
ghcr.io/<owner>/menu:<MENU_IMAGE_SHA> node scripts/migrate.mjs`.

The migrate script holds `pg_advisory_lock(727072073)` for
concurrent-deploy safety. Inputs: `MENU_IMAGE_SHA` env (default
"latest"), `hetzner_ipv4` + `menu_database_url` from `tofu output`
(nested `bin/with-secrets --stage iac` call — Stage 3's env scope
doesn't include the postgres password directly).

**docker login** before pull: Stage 3 runs with `IAC_BOOTSTRAP_GHCR_TOKEN`
in scope (universal), the binary `docker login ghcr.io
--password-stdin` before each pull.

**Why this is Stage 3 and not in Stage 4's `dockerOnHetzner`**: a bad
migration fails loud in the deploy log without crash-looping the live
menu container. Multi-replica future is also unblocked — migrations
run once per deploy, not once per replica boot.

#### `openobserve-dashboards` → [`bin/openobserve-dashboards`](../infra/bin/openobserve-dashboards)

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

## Stage 4 — Deploy (`task deploy:<product>`)

Per-product. Fans out across the registry in
[`infra/cmd/iedora/products.go`](../infra/cmd/iedora/products.go). Each
product has a `productRuntime` — the polymorphism point for "how does
this product get shipped to its runtime."

### Current runtimes

#### `dockerOnHetzner` → menu

For Docker-runtime products that run on the shared Hetzner VPS.

**Deploy flow**:

1. Mint any per-product `appSecrets` not yet in BWS (menu mints
   `DEPLOY_MENU_SESSION_SECRET` on first deploy).
2. Resolve box IPv4 from `tofu output -raw hetzner_ipv4`.
3. Compose env from `envStatic` + `envFromBWS` (Stage 3 outputs +
   AUTOGEN secrets) + `envFromTofu` (DATABASE_URL, OTEL endpoint, S3
   creds, etc. — composed values from Tofu state).
4. SSH to box, `docker login ghcr.io`, `docker pull <image>:<sha>`.
5. `docker stop <container> && docker rm <container> && docker run -d
   ...` with the composed env, network alias, log opts.

**Inputs**:
- `MENU_IMAGE_SHA` env — set by CI (`github.sha`) or operator (export).
  Default "latest".
- `IAC_BOOTSTRAP_HOST_IP` — universal-scope BWS key, written by Stage 2.
- All `envFromBWS` keys — visible in `--stage deploy --product menu`
  scope.

**Caddy routing**: `infra-caddy` resolves `infra-menu-web` by docker
network alias. Between deploys (container stopped) it returns 502 —
correct behavior; restored as soon as Stage 4 lands.

#### `cloudflareWorker` → house

For static-site products on Cloudflare Workers.

**Deploy flow**:

1. `bun run build` in `products/<name>/` (Astro for house).
2. `tofu init -upgrade` in `products/<name>/infra/tofu/`.
3. `tofu apply -auto-approve` — uses
   `cloudflare/cloudflare 5.11+`'s native dist/ upload directly inside
   `cloudflare_workers_script`, no wrangler needed.

**Inputs**: `IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN` + `IAC_BOOTSTRAP_STATE_PASSPHRASE` —
both visible in `--stage deploy --product house` (per-product Tofu
state is separately encrypted).

### Adding a product

1. `mkdir products/<name>/` with build config.
2. (Optional) `products/<name>/infra/tofu/` for per-product cloud
   resources (own R2 bucket, custom domain, workers script).
3. One struct entry in `products.go` selecting a `productRuntime`. If
   the deploy shape is new (not Docker, not CF Workers), add a new
   `runtime_<kind>.go` implementing the `productRuntime{Deploy,
   Destroy}` interface.
4. `.github/workflows/<name>.yml` — copy menu.yml or house.yml, swap
   names. Dispatches the reusable
   [`deploy.yml`](../.github/workflows/deploy.yml) workflow with
   `inputs.product = <name>`.

Zero orchestrator code changes needed.

## Stage-filtered secrets

`bin/with-secrets [--stage iac|app|deploy] [--product NAME] -- <cmd>`.
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

> **Migration**: legacy `INFRA_*`/`AUTOGEN_INFRA_*` names were renamed
> in May 2026. `task bws:rename` runs the one-shot migrator
> ([`infra/cmd/bws-rename-2026-05/`](../infra/cmd/bws-rename-2026-05/));
> idempotent, safe to re-run, delete the command after the first run on
> prod.

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
[`infra/cmd/with-secrets/env_test.go`](../infra/cmd/with-secrets/env_test.go)
cover every stage path.

## Local commands (Taskfile)

```bash
task doctor                      # Preflight: PATH, BWS auth, bootstrap secrets present.

task up                          # Full pipeline: infra:up → app:apply → deploy:all.
task down                        # Full teardown: products → infra:down.

task infra:up                    # Stage 2 only — tofu apply on infra/tofu/.
task infra:down                  # Stage 2 destroy.
task app:apply                   # Stage 3 — every configurator.
task deploy:menu                 # Stage 4 menu.
task deploy:house                # Stage 4 house.
task deploy:all                  # Stage 4 — fan out every product in parallel.

task dev                         # Boot the local dev stack (docker on local).
task dev:down                    # Tear down dev.
task dev:reset-db -- menu        # Drop + recreate one database without touching the rest.

task bws -- <cmd>                # Exec a command with BWS hydrated (stage=iac default).
task zitadel:grants              # Re-run iedora-admin grants only (`bin/zitadel-apply --grants-only`).
```

Each task is a 1-line shim into the Go orchestrator. The Taskfile
exists so the operator has a stable command surface; the actual logic
is in `infra/cmd/iedora/` and the per-configurator/per-runtime
binaries.

## CI flow

Per-stage workflows. Each is independently dispatchable; the chain
flows via `workflow_run` triggers.

| Workflow | Stage | Trigger |
|----------|-------|---------|
| [`infra-deploy.yml`](../.github/workflows/infra-deploy.yml) | 2 | push to main on `infra/tofu/**`, `infra/cmd/iedora/**`, `infra/cmd/with-secrets/**`, `Taskfile.yml`. Manual dispatch. |
| [`app-state.yml`](../.github/workflows/app-state.yml)       | 3 | `workflow_run` on infra-deploy success. Also: push on `infra/cmd/zitadel-apply/**`, `infra/cmd/menu-db-migrations/**`, `infra/cmd/openobserve-dashboards/**`. Manual dispatch. |
| [`menu.yml`](../.github/workflows/menu.yml)                 | 1+4 | push to main on `products/menu/**`. Build + push image, then dispatches `deploy.yml(product=menu, sha=...)`. |
| [`house.yml`](../.github/workflows/house.yml)               | 1+4 | push to main on `products/house/**`. Dispatches `deploy.yml(product=house)`. |
| [`deploy.yml`](../.github/workflows/deploy.yml)             | 4 | reusable `workflow_call` invoked by `menu.yml` / `house.yml`. Generic over `product`. |

Every workflow runs `bin/with-secrets --stage <s> -- ...` so CI sees
the same stage-scoped env operators do.

State commit-back: both `infra-deploy.yml` and the per-product Tofu
side of `deploy.yml` commit the encrypted `terraform.tfstate` back to
`main` after a successful apply — git stays canonical.

## Local dev stack (`task dev`)

[`infra/cmd/dev/`](../infra/cmd/dev/) boots the same shape on the
operator's Docker daemon — postgres, zitadel, zitadel-login,
localstack (S3), openobserve. Same configurator pattern: after
containers come up, the dev orchestrator runs `bin/zitadel-apply
--no-bws --output-file infra/dev/.zitadel-bootstrap/outputs.json`
against `localhost:8080`, then composes
`products/menu/.env` + `.env.local` in Go from the outputs file +
tofu outputs + minted random session secret.

Menu runs via `bun run dev` from the host (not as a container in
dev). House runs as a container.

`task dev --only menu` brings up menu's deps only. `--except <service>`
boots everything except the named ones. `task dev:reset-db -- <name>`
drops + recreates one database.

## Day-2 operations

Most day-2 work is SSH against the box. Resolve the host once and re-use:

```bash
HOST=$(infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu output -raw hetzner_ipv4)

# Logs
ssh root@$HOST docker logs -f --tail=200 infra-zitadel        # or infra-menu-web / infra-caddy / …

# psql
ssh -t root@$HOST docker exec -it infra-postgres psql -U postgres

# Force a pg_dump now
ssh root@$HOST docker exec infra-backups sh /backup.sh

# Restore latest dump
ssh -t root@$HOST docker exec -it infra-backups sh /restore.sh

# Open the OpenObserve UI via SSH tunnel (OO is internal-only)
ssh -L 5080:localhost:5080 root@$HOST   # then open http://localhost:5080
```

### Secret rotation

| Secret kind | How to rotate |
|-------------|---------------|
| `INFRA_*` bootstrap (HCLOUD, CF, GH, etc.) | Regenerate at the source provider, then `bws secret edit <id>` with the new value. |
| `IAC_*` (Tofu-minted) | `infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu apply -replace=random_password.<name>`. The `terraform_data.bws_sync_autogen` write-through pushes the new value to BWS automatically. |
| `APP_ZITADEL_MENU_SA_TOKEN` | `bws secret delete <id>`, then `task app:apply` — zitadel-apply detects `(no BWS, yes Zitadel)`, deletes the live PAT, mints a new one, writes BWS. Menu container restarts on next `task deploy:menu`. |
| `DEPLOY_MENU_SESSION_SECRET` | `bws secret delete <id>`, then `task deploy:menu`. `dockerOnHetzner.appSecrets` re-mints. All active sessions invalidate (users re-auth). |
| `IAC_ZITADEL_MASTERKEY` | **Don't rotate casually.** It encrypts Zitadel's projection table — re-keying mid-flight is unsupported. To actually rotate: `TF_VAR_allow_masterkey_rotation=true task infra:up` (one-time override on the prevent_destroy lifecycle guard), then a Zitadel rebootstrap (see below). |

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
task infra:up
task app:apply        # fetches the fresh SA key, reconciles org/project/PAT/etc. cold
task deploy:menu      # restart menu with the new OIDC client_secret + PAT
```

### Backups

`infra-backups` runs an internal cron that calls
[`infra/backup/backup.sh`](../infra/backup/backup.sh) `@daily`:
`pg_dumpall` every database on `infra-postgres` → R2 (`iedora-data`
bucket, `pg/` prefix), GPG-encrypted with
`IAC_BACKUP_PASSPHRASE`.

Restore: `ssh -t root@$HOST docker exec -it infra-backups sh /restore.sh`.

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

5. **Run the pipeline**: `task doctor && task up`. First time: 5–10
   min. Validate `https://menu.iedora.com/up` returns
   `{"ok":true,"db":"ok"}`.

## Failure modes

The ones operators are likely to hit. Most are recoverable by re-running
the affected stage.

| Symptom | Stage | Cause | Recovery |
|---------|-------|-------|----------|
| `Host key verification failed` from kreuzwerker/docker | 2 | Hetzner recycled an IPv4 that's still in `~/.ssh/known_hosts` | Orchestrator runs `ssh-keygen -R` automatically before Pass 2. If hit manually: `ssh-keygen -R <ip>` + retry. |
| `x509: certificate signed by unknown authority` after Zitadel ready | 3 | Caddy served `/debug/ready` via internal CA while ACME was mid-challenge | `tlsprobe.probeCertIssuer` rejects "Caddy Local Authority"; budget is 6m. If exhausted: `ssh root@$HOST docker logs infra-caddy` for LE rate-limit / firewall issues. |
| `Errors.Target.DeniedURL` on action_target create | 3 | Zitadel's URL validator can't resolve `menu.iedora.com` from inside the iedora docker network | `zitadel-apply` runs `waitForMenuDNS` before creating action targets — 90s budget. Increase if it fires. |
| `found N PATs on machine user "menu-sa" (expected 0 or 1)` | 3 | Prior run crashed mid-create OR two operators raced. Concurrent guard refuses to silently delete the wrong one. | Reconcile via Zitadel UI; re-run `task app:apply`. |
| `BWS missing APP_ZITADEL_*` | 4 | Stage 3 didn't complete | Run `task app:apply` first; or `task up` chains them. |
| `tofu output X empty` | 4 | Stage 2 wasn't run, OR an `outputs.tf` entry was added but not applied | Run `task infra:up`. |
| `unauthorized` from `docker pull ghcr.io/...` | 3/4 | `IAC_BOOTSTRAP_GHCR_TOKEN` expired OR not in scope | Regenerate the PAT, `bws secret edit`. The configurator's `docker login` step uses `--password-stdin` so the token never appears in `docker history`. |
| `menu-db-migrations: connection refused` | 3 | `infra-postgres` isn't up | `ssh root@$HOST docker ps`. If missing, `task infra:up`. |
| `iedora.com` 530 / connection refused | n/a | A record resolves but TLS fails | Either `infra-caddy` is down (`docker logs infra-caddy`) or the worker isn't published. CF Workers' apex custom-domain takes a few seconds after `cloudflare_workers_custom_domain` create. |
| `menu.iedora.com` 502 between deploys | 4 | Stage 4 stopped `infra-menu-web` and the new container hasn't come up yet | Wait ~5s. If persistent: `task deploy:menu` to restart. |
| `tofu apply` hangs at Pass 2 | 2 | Cloud-init still installing Docker. `null_resource.docker_ready` waits up to 5m | `ssh root@<ip> 'cloud-init status'`. If stuck >10m: `tofu apply -replace=hcloud_server.iedora` for a fresh box. |
| Destroy fails: `bucket not empty` 409 on CF R2 | 2 | `internal/r2.EmptyBucket` failed silently | Read the destroy log's `! R2 empty failed` line; check `infra/internal/r2/r2_test.go` is green; manually empty via the CF dashboard, retry. |

## Pre-merge runbook

Run before merging any change to the orchestrator (`infra/cmd/iedora/`,
`infra/cmd/with-secrets/`, `infra/cmd/zitadel-apply/`, the other Stage 3
binaries, `infra/tofu/*.tf`, `infra/internal/*`, `infra/bin/*`,
`Taskfile.yml`, or `products/*/infra/tofu/*.tf`). The sequence proves
the moving parts compose correctly against live cloud APIs — unit
tests cover individual helpers but only this catches cross-API
problems (DNS races, state-vs-cloud drift, one-shot reveal recovery).

```bash
task down       # 1: tear down from any state — idempotent
task up         # 2: cold deploy (full bootstrap)
task up         # 3: warm — every stage should be no-diff/no-op
task down       # 4: destroy from a full estate
task up         # 5: cold deploy AGAIN — catches state-vs-cloud drift, DNS races
task up         # 6: warm — final idempotency check
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
| 1. destroy | `iedora iac destroy` works from any state. R2 buckets emptied; BWS keys scrubbed; known_hosts cleaned. |
| 2. cold deploy | Full bootstrap: 34 Tofu resources, all 3 configurators run cold, both products deploy. |
| 3. warm deploy | Idempotency at every stage. Stage 2: `0 added, 0 changed, 0 destroyed`. Stage 3: all "updated" or "no diff". Stage 4: re-pull same SHA → no container restart. |
| 4. destroy (full) | R2 emptying works against real R2. House per-product Tofu destroys cleanly. |
| 5. cold deploy #2 | DNS gate inside zitadel-apply fires correctly. PAT/signing-key recovery matrix works. |
| 6. warm deploy | Final no-op. |

### Expected state after a cold deploy

- **Tofu state** (`infra/tofu/`): ~40 resources (hcloud VPS/firewall/key, docker_network + volumes, the shared `module.*` blocks for postgres/zitadel/zitadel-login/openobserve/backups, cloudflare R2/DNS/api_tokens, github_actions_secret/variable, random_password.*, terraform_data.bws_sync_autogen).
- **House Tofu state** (`products/house/infra/tofu/`): 3 resources (cloudflare_workers_script.house, cloudflare_workers_custom_domain.apex, data.cloudflare_zone.iedora).
- **BWS**: 6 `APP_ZITADEL_*` outputs from Stage 3 + `DEPLOY_MENU_SESSION_SECRET` minted by Stage 4.
- **Zitadel**: org `iedora`, project `iedora`, 6 roles, machine user `menu-sa` with 1 PAT + IAM_OWNER, OIDC app `menu`, 2 action targets with executions.
- **Box** (`ssh root@$HOST docker ps`): `infra-postgres`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `infra-openobserve`, `infra-backups`, `infra-menu-web`.
- **Public endpoints**:
  - `https://menu.iedora.com/up` → 200 `{"ok":true,"db":"ok"}`
  - `https://auth.iedora.com/.well-known/openid-configuration` → 200
  - `https://iedora.com` → 200 (`<title>Iedora. House of Software.</title>`)

## File map

```
infra/
  bin/                                   thin wrappers around the Go binaries
    iedora                                 `go run cmd/iedora` — the orchestrator
    with-secrets                           `go run cmd/with-secrets` — stage-filtered env
    zitadel-apply                          `go run cmd/zitadel-apply` — Stage 3 configurator
    menu-db-migrations                     `go run cmd/menu-db-migrations` — Stage 3 configurator
    openobserve-dashboards                 `go run cmd/openobserve-dashboards` — Stage 3 configurator
    bws-upsert                             Tofu local-exec helper (BWS write-through)

  cmd/
    iedora/                                orchestrator: subcommands + runtime registry
      main.go, iac.go, app.go, deploy.go, pipeline.go, doctor.go
      runtime.go, runtime_docker.go, runtime_cf.go    productRuntime + 2 impls
      configurators.go                                Stage 3 registry
      products.go                                     Stage 4 registry
      ssh.go, tofu.go, paths.go, log.go
    with-secrets/                          BWS wrapper. main.go + env.go + env_test.go.
    zitadel-apply/                         Stage 3 — Zitadel reconciler.
      main.go, client.go, bootstrap.go, reconcile.go, store.go,
      schema.go, wait_dns.go
    menu-db-migrations/                    Stage 3 — drizzle-kit migrate via SSH + docker run.
    openobserve-dashboards/                Stage 3 — SSH-L tunnel + embedded JSONs + REST.
      main.go + dashboards/*.json
    bws-upsert/                            BWS write-through helper for Tofu.
    dev/                                   local dev stack orchestrator.

  internal/
    bws/                                   bws CLI wrapper (ProjectID, ListSecrets, Find, Upsert, Delete)
    cloudflare/                            CF /accounts API + R2 S3 creds derivation
    r2/                                    R2 S3 client (EmptyBucket for destroy)
    tlsprobe/                              `Wait()` for /debug/ready + LE-cert-not-Caddy-internal
    testfakes/                             test-only HTTP server fakes

  tofu/                                    Stage 2 — central Tofu root
    versions.tf, variables.tf, hetzner.tf, main.tf, containers.tf,
    secrets.tf, github.tf, outputs.tf
  modules/services/                        Tofu modules for each shared service
    postgres/, zitadel/, zitadel-login/, openobserve/, localstack/, house/

  dev/tofu/                                local dev Tofu root (mirrors prod shape)
  backup/                                  self-built Postgres-backup image (Dockerfile + sh scripts)
```

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
  `products/house/infra/tofu/` can't plan a change against the menu
  container. Each stage is independently runnable for surgical re-rolls
  (`task app:apply --only menu-db-migrations`).

- **Adding products + configurators is mechanical.** New product =
  struct literal + 1 workflow file. New Stage 3 configurator = struct
  literal + 1 binary. No orchestrator code changes.

- **BWS as the bus** means no Tofu round-trips for app values. Stage 3
  writes outputs; Stage 4 reads them directly. The encrypted Tofu state
  is canonical for infra; BWS is canonical for app state.

The trade-off: re-implementing CRUD against ~10 Zitadel REST endpoints
(~2000 LOC of Go vs ~430 LOC of Tofu). Worth it given the operational
pain the Tofu-managed Zitadel inflicted.
