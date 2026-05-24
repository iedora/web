# Deploy — 4-stage pipeline (`task up`)

One command, full stack, behind Cloudflare DNS + on-box Caddy TLS. Tofu owns the infrastructure (Hetzner VPS, Cloudflare, GitHub config, Docker network, shared service containers). A Go reconciler owns Zitadel app config. Per-product runtimes own each product's container/script lifecycle.

```
Stage 1: Build & Test    per-product (bun, docker build, tests)
Stage 2: IaC             task infra:up   — tofu apply on infra/tofu/
Stage 3: AppState        task app:apply  — bin/zitadel-apply (+ future configurators)
Stage 4: Deploy          task deploy:<p> — per-product runtime (Docker on Hetzner / CF Workers)
```

`task up` chains 2 → 3 → 4 in order. Each stage is independently runnable for surgical re-rolls.

```
Internet → Cloudflare DNS (grey-cloud A records, no proxy/tunnel)
            ├─→ menu.iedora.com   → Hetzner :443 → infra-caddy → infra-menu-web:3000
            ├─→ auth.iedora.com   → Hetzner :443 → infra-caddy → infra-zitadel:8080
            ├─→ obs.iedora.com    → Hetzner :443 → infra-caddy → infra-openobserve:5080
            └─→ assets.iedora.com → R2 bucket via custom domain
```

Reference target: Hetzner CPX22 (Falkenstein, x86_64, 2 vCPU / 4 GB / public IPv4). `infra/tofu/hetzner.tf` provisions it from scratch via the `hcloud` provider.

**Modifying the deploy pipeline?** See [`deploy-validation.md`](deploy-validation.md) — the 6-step end-to-end runbook that must pass before merging any change to the orchestrator, the Tofu roots, or the BWS wrapper.

---

## Step 1 — Local prerequisites (one-time)

```bash
# macOS
brew install opentofu gh just
brew install --cask orbstack             # or docker desktop
gh auth login

# Linux
curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method standalone
curl -fsSL https://get.docker.com | sh
sudo apt install -y gh
gh auth login
```

Verify: `tofu version`, `docker info`, `gh auth status`.

## Step 2 — GitHub Container Registry scope

```bash
gh auth refresh -s write:packages
```

CI pushes the menu image to `ghcr.io/<your-github-username>/menu`.

## Step 3 — Cloudflare prep

Existing zone required (a domain on your Cloudflare account). Create a scoped API token:

1. `dash.cloudflare.com` → API Tokens → Create Custom Token. Permissions:
   - **Account · Account Settings · Read**
   - **Account · Workers R2 Storage · Edit** (backups + observability + menu assets)
   - **Zone · DNS · Edit** (scoped to your zone)
   - **User · API Tokens · Edit** (Tofu mints the R2 sub-tokens)
2. Copy into BWS as `INFRA_CLOUDFLARE_API_TOKEN`.

Grab your Account ID and Zone ID from the dashboard sidebar.

## Step 4 — Provision the VPS

Tofu provisions the Hetzner box itself; you don't pre-create it. Tofu needs your `hcloud` API token (`INFRA_HCLOUD_TOKEN` in BWS) and an SSH public key.

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

Tofu reads `~/.ssh/id_ed25519.pub`, registers it as `hcloud_ssh_key.operator`, and seeds it into `/root/.ssh/authorized_keys` on the freshly minted CPX22. After the first deploy, `ssh root@<hetzner-ipv4>` works.

To reuse an existing box: `tofu import hcloud_server.iedora <server-id>` so the state captures the existing IPv4 as `hetzner_ipv4`. Tooling reads from that output directly — there is no BWS write-through.

> **Why root?** SSH-key-only root login is the canonical Docker-over-SSH path — `kreuzwerker/docker` shells out to system SSH, which honors `~/.ssh/config`. The non-root path requires NOPASSWD-sudo (same root blast radius without the simplicity).

## Step 5 — Clone, configure, populate BWS

```bash
git clone https://github.com/<you>/iedora.git
cd iedora
```

**The only env var you need locally is `BWS_ACCESS_TOKEN`.** Keep it in your password manager / `~/.secrets` / shell profile — losing it means losing every other secret.

```bash
# in ~/.secrets (or whichever profile your shell sources)
export BWS_ACCESS_TOKEN=0.…
```

`infra/bin/with-secrets` derives the rest:

| Was an input | Now |
|---|---|
| `BWS_PROJECT_ID` | discovered via `bws project list` (picks `iedora-deploy`) |
| `CLOUDFLARE_ACCOUNT_ID` | discovered via CF `/accounts` API using `INFRA_CLOUDFLARE_API_TOKEN` from BWS |
| `GHCR_USER`, `OPENOBSERVE_BUCKET_NAME` | TF variable defaults in `infra/tofu/variables.tf` |
| `ONPREM_HOST` | `tofu output -raw hetzner_ipv4` after pass 1 |

Install `bws`: `brew install bitwarden/tap/bws` or download from https://github.com/bitwarden/sdk-sm/releases. Then populate BWS with the keys you have to obtain from third parties — Tofu mints the rest itself.

```bash
PROJECT_ID=$(bws project list -o json | jq -r '.[] | select(.name=="iedora-deploy") | .id')
for KEY in INFRA_CLOUDFLARE_API_TOKEN INFRA_STATE_PASSPHRASE \
           INFRA_HCLOUD_TOKEN INFRA_GITHUB_API_TOKEN INFRA_GHCR_TOKEN \
           INFRA_SSH_PRIVATE_KEY INFRA_CLAUDE_CODE_OAUTH_TOKEN \
           INFRA_OPENOBSERVE_ROOT_USER_EMAIL; do
  read -s -p "$KEY: " V && echo
  bws secret create "$KEY" "$V" "$PROJECT_ID" -o none
done
```

| Key | Source |
|---|---|
| `INFRA_CLOUDFLARE_API_TOKEN` | CF dashboard → API Tokens. Needs **Account:Read** so the wrapper can resolve `CLOUDFLARE_ACCOUNT_ID`. |
| `INFRA_STATE_PASSPHRASE` | `openssl rand -hex 32`. Encrypts Tofu state. Has to come from outside Tofu — chicken-and-egg with the state encryption itself. |
| `INFRA_HCLOUD_TOKEN` | Hetzner console → Security → API tokens (R/W). |
| `INFRA_GITHUB_API_TOKEN` | Fine-grained PAT scoped to the repo. |
| `INFRA_GHCR_TOKEN` | Classic PAT with `write:packages` (see "Why classic" below). |
| `INFRA_SSH_PRIVATE_KEY` | `cat ~/.ssh/id_ed25519`. Load-bearing across BWS / GH secrets / docker provider / rotation playbook — don't rename. |
| `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | `claude login` then read the OAuth token. |
| `INFRA_OPENOBSERVE_ROOT_USER_EMAIL` | Your operator email — receives OO alerts. |

**The 5 `AUTOGEN_INFRA_*` keys you DON'T populate** — Tofu mints them on first apply via `random_password` resources (`infra/tofu/secrets.tf`) and write-throughs to BWS for human lookup:

- `AUTOGEN_INFRA_POSTGRES_PASSWORD`
- `AUTOGEN_INFRA_BACKUP_PASSPHRASE`
- `AUTOGEN_INFRA_ZITADEL_MASTERKEY` (lifecycle.prevent_destroy guards it)
- `AUTOGEN_INFRA_ZITADEL_FIRST_ADMIN_PASSWORD` (look it up in BWS for the first Zitadel login)
- `AUTOGEN_INFRA_OPENOBSERVE_ROOT_USER_PASSWORD`

> **Why classic for GHCR.** Every other PAT is fine-grained; `INFRA_GHCR_TOKEN` stays classic because fine-grained + personal account + GHCR is GitHub's worst-supported combination — the Packages permission only reliably surfaces for org-scoped tokens with org-owned packages. Revisit if iedora moves into a GH org.

## Step 6 — Deploy

```bash
task up
```

Walks the 4-stage pipeline end-to-end:

1. **Stage 2 — `task infra:up`.** Tofu apply on `infra/tofu/`: Hetzner VPS, Cloudflare (R2 + DNS), GitHub Actions config, Docker network/volumes, and the *shared* containers (`infra-postgres`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `infra-openobserve`, `infra-backups`). NOT `infra-menu-web` — that's Stage 4. Internally a 2-pass apply (targeted hcloud → full apply) so the `kreuzwerker/docker` provider has an IP at plan time.
2. **Stage 3 — `task app:apply`.** Waits for Zitadel `/debug/ready` + LE cert, then runs every registered configurator in sequence: `zitadel-app-config` (org/project/roles/OIDC app/PAT/action targets via REST), `menu-db-migrations` (drizzle-kit migrate via a one-shot docker run on the box), `openobserve-dashboards` (curl + jq push). Cold-deploy adds an SA-key fetch step (the FirstInstance JSON key gets pulled out of the `zitadel-bootstrap` volume into BWS so the reconciler can authenticate).
3. **Stage 4 — `task deploy:all`.** Fans out across products. For menu (`dockerOnHetzner` runtime): SSH to box → `docker pull` → `docker stop/rm/run` with env composed from BWS (Stage 3 outputs + AUTOGEN secrets) + Tofu outputs. Menu's session secret is minted on first deploy and persisted to BWS. For house (`cloudflareWorker` runtime): `bun run build` + `tofu apply` on `products/house/infra/tofu/`.

First time: 5–10 min. Subsequent `task up`: 30s–2 min (Stage 2 no-diff refresh, Stage 3 idempotent, Stage 4 re-pull only on new image SHA).

Verify: `https://menu.iedora.com/up` → `{"ok":true,"db":"ok"}`.

---

## Day-2 commands

```bash
task up                      # full pipeline (idempotent on warm runs)
task infra:up                # Stage 2 only — re-apply tofu without re-deploying
task app:apply               # Stage 3 only — re-reconcile Zitadel + migrations + dashboards
task deploy:menu             # Stage 4 only — re-pull + restart menu container
task down                    # tear down VPS + every resource
task doctor                  # preflight check
```

Stage 3 configurators (run in order by `task app:apply`):

| Configurator              | What it does                                                          |
|---------------------------|-----------------------------------------------------------------------|
| `zitadel-app-config`      | Reconciles org/project/roles/OIDC app/PAT/action targets via REST.    |
| `menu-db-migrations`      | Runs drizzle-kit migrate against menu DB (one-shot on the box).       |
| `openobserve-dashboards`  | Pushes business + technical + correlation dashboards to OpenObserve.  |

Re-run a single configurator without the rest: `task bws -- bin/with-secrets --stage app -- bin/<name>` (e.g. `bin/menu-db-migrations`).

Everything else is raw SSH. Resolve the host once, then re-use:

```bash
HOST=$(infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu output -raw hetzner_ipv4)

ssh root@$HOST docker logs -f --tail=200 infra-backups            # or infra-zitadel / infra-menu-web / …
ssh -t root@$HOST docker exec -it infra-postgres psql -U postgres # psql shell
ssh root@$HOST docker exec infra-backups sh /backup.sh            # force a pg_dump
ssh -t root@$HOST docker exec -it infra-backups sh /restore.sh    # restore latest dump
ssh root@$HOST 'docker rm -f infra-postgres; rm -rf /root/infra-postgres'  # wipe (then re-deploy)
```

For secret rotation see [`docs/secrets.md`](secrets.md) — non-AUTOGEN keys
are a `bws secret edit` directly; AUTOGEN_* sub-tokens regenerate via
`infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu apply -replace=random_password.<name>`.

`bin/iedora` and `bin/with-secrets` (in `infra/bin/`) hide the BWS dance — only `BWS_ACCESS_TOKEN` needs to live in your shell. `BWS_PROJECT_ID` is discovered via `bws project list`, `CLOUDFLARE_ACCOUNT_ID` via CF's `/accounts` API, and every BWS secret is exported per-stage (`--stage iac | app | deploy`).

**Migrations run in Stage 3**, not on container start — the `menu-db-migrations` configurator SSHes to the box and `docker run --rm`s the migrate.mjs script from the current menu image. Failures fail loud in the Stage 3 log without crash-looping the live menu.

**Rolling back to a previous image.** `gh workflow run deploy.yml --field product=menu --field image_sha=<older-sha>`. Image SHAs are tagged by commit on every push to main. Stage 3 will re-run migrations against the older image (idempotent — drizzle's tracking table handles forward gaps). Brief downtime (~5–10s while Stage 4 stops + replaces the container).

---

## Continuous deployment

Once the manual flow works end-to-end, CI rolls each stage on the relevant trigger.

```
git push main (products/menu/**)
   └─► .github/workflows/menu.yml         (typecheck, lint, unit, security, e2e)
        └─► build + push image            (linux/amd64 → ghcr.io/eduvhc/menu:<sha>)
             └─► uses: ./.github/workflows/deploy.yml
                  └─► product=menu, image_sha=<sha>
                       ├─► task deploy:menu
                       │   └─► dockerOnHetzner.Deploy
                       │       ├─► docker pull ghcr.io/.../menu:<sha>
                       │       ├─► docker stop + rm + run infra-menu-web
                       │       └─► env composed from BWS + tofu outputs
                       └─► curl https://menu.iedora.com/up  (smoke)

git push main (infra/tofu/** or infra/cmd/**)
   └─► .github/workflows/infra-deploy.yml
        └─► task infra:up
             ├─► tofu init  (decrypts state via INFRA_STATE_PASSPHRASE)
             └─► tofu apply on infra/tofu/
        └─► workflow_run: success → triggers app-state.yml
             └─► .github/workflows/app-state.yml
                  └─► task app:apply
                       ├─► zitadel-app-config
                       ├─► menu-db-migrations
                       └─► openobserve-dashboards

git push main (infra/cmd/zitadel-apply/** or configurator code)
   └─► .github/workflows/app-state.yml directly (paths-filtered trigger)
        └─► task app:apply
```

Per-product workflows (menu, house) dispatch the shared `deploy.yml`. Infra changes flow through `infra-deploy.yml` then automatically into `app-state.yml`. Each stage is independently dispatchable for surgical re-rolls.

The only SSH path in CI is Stage 4 (`dockerOnHetzner` runtime) and Stage 3's SA-key fetch (cold deploys only) — both use `INFRA_SSH_PRIVATE_KEY` from GH Secrets. The `kreuzwerker/docker` provider in Stage 2 talks to the box for shared containers only.

### Tofu-managed GH config

Every GH Actions secret + variable is Tofu-managed via `infra/tofu/github.tf` (`integrations/github`'s `for_each` over a locals map). Set the BWS source, `task up` reconciles GH from BWS.

| GH Secret | BWS source | Notes |
|---|---|---|
| `BWS_ACCESS_TOKEN` | `BWS_ACCESS_TOKEN` (passed as `TF_VAR_bws_access_token`) | Runner uses it to authenticate to BWS for every other secret |
| `INFRA_SSH_PRIVATE_KEY` | `INFRA_SSH_PRIVATE_KEY` | Runner writes to `~/.ssh/id_ed25519`; reaches the Hetzner box |
| `CLAUDE_CODE_OAUTH_TOKEN` | `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | Powers `.github/workflows/claude.yml` |

| GH Variable | Notes |
|---|---|
| `BWS_PROJECT_ID` | Same as local `.env` |
| `MENU_PUBLIC_HOSTNAME` | `menu.iedora.com` |
| `CLOUDFLARE_ACCOUNT_ID` | Same as local `.env` |

The VPS IPv4 is NOT a GH variable. CI reads it directly inside the runner with `tofu output -raw hetzner_ipv4` after `tofu init` decrypts the state. The `GHCR_USER` falls back to `github.repository_owner` and isn't materialized either.

**House workload token is auto-populated.** The house deploy (CI on push to main, or `task deploy:house` locally) mints the narrow Workers token via Tofu and write-throughs to BWS as `INFRA_HOUSE_WORKERS_TOKEN`. Rotate by running `infra/bin/with-secrets --stage deploy --product house -- tofu -chdir=products/house/infra/tofu apply -replace=cloudflare_api_token.workers_deploy` (never bare `tofu apply -replace=...` without the write-through, or BWS goes stale).

### Manual operations

```bash
gh workflow run infra-deploy.yml                                  # re-roll Stage 2
gh workflow run app-state.yml                                     # re-roll Stage 3
gh workflow run deploy.yml --field product=menu                   # re-roll Stage 4 menu
gh workflow run deploy.yml --field product=menu --field image_sha=<sha>   # menu rollback
gh workflow run menu.yml --ref <branch>                           # re-trigger menu CI on a branch
gh run watch                                                      # tail the latest run
```

Local rollback: `MENU_IMAGE_SHA=<previous-good-sha> task deploy:menu`.

### Supply-chain verification

Every successful menu build mints two Sigstore-signed attestations on the GHCR image: SLSA build provenance + SBOM. Verify:

```bash
gh attestation verify oci://ghcr.io/eduvhc/menu:<sha> --owner eduvhc
gh attestation verify oci://ghcr.io/eduvhc/menu:<sha> --owner eduvhc --type sbom
```

Failures = image is from outside our CI, registry returned wrong content, or attestations were stripped. Post-deploy Trivy image scan populates Security tab with any CVE findings.

### When NOT to use CI for deploy

- First-ever setup on a fresh laptop (bootstrap is local-only).
- Substantial Tofu changes (rehearse locally; CI auto-approves).
- Anything destructive (`tofu destroy`, `wipe-postgres`, `zitadel-rebootstrap`).

---

## How values flow

- `BWS_ACCESS_TOKEN` (shell env) → `bin/with-secrets --stage <s>` calls `bws project list` to pick the `iedora-deploy` project, then `bws secret list`, then filters to only the keys whose stage classification matches.
- `INFRA_CLOUDFLARE_API_TOKEN` (when in scope) → wrapper calls CF `/accounts` API → `CLOUDFLARE_ACCOUNT_ID` exported as `TF_VAR_account_id`.
- In iac/deploy stages: BWS secrets → `TF_VAR_*` aliases → Tofu reads them as variable inputs.
- In app stage: BWS secrets → env on the configurator binary directly (no TF_VAR_*; Stage 3 doesn't run Tofu).
- In deploy stage with `--product menu`: Stage 4 reads Zitadel outputs (Stage 3's BWS write-back) + AUTOGEN_INFRA_MENU_SESSION_SECRET → composed into the menu container's `docker run -e KEY=VAL` flags.
- Registry pull → Stage 4's runtime SSHes to the box and `docker pull`s; the box's daemon authenticates via the kreuzwerker/docker `registry_auth` block established at Stage 2.

Every secret has exactly one source (BWS), exactly one stage that can read it, zero hops where a human pastes a value between systems.

---

## Why one Tofu root per blast-radius unit

The shared root (`infra/`) owns infra-shaped cross-product resources (VPS, Cloudflare, GitHub config, shared service containers) only. Per-product roots (`products/menu/infra/tofu/`, `products/house/infra/tofu/`) own product-local resources — for menu, the assets R2 bucket + `assets.iedora.com`; for house, the Cloudflare Workers script + the narrow `workers_deploy` token. The menu container itself doesn't live in any Tofu root — Stage 4 (`task deploy:menu`) owns its lifecycle via the `dockerOnHetzner` runtime.

1. **Blast radius.** A typo in `products/house/infra/tofu/` literally cannot plan a change against the menu container — neither lives in the same state.
2. **Lifecycles.** The menu container changes per-push (Stage 4); the assets bucket changes once a quarter (per-product Tofu); the VPS + shared containers change rarely (Stage 2).
3. **Secrets surface.** The narrow `workers_deploy` token lives only in the house state.

Cost: ~30 lines duplicated per per-product Tofu root (versions.tf, credentials, `data.cloudflare_zone "this"` lookup).

---

## Troubleshooting

> **Where the deploy logic lives.** `task` recipes at the repo root shell into `infra/bin/iedora` (a thin `go run` wrapper over `infra/cmd/iedora/`). The orchestrator dispatches to `iac apply|destroy`, `app apply`, `deploy <product>`, `destroy <product>`, or `pipeline`. Stage 3 configurators are separate binaries under `infra/cmd/<configurator-name>/` registered in `infra/cmd/iedora/configurators.go`. The Let's-Encrypt-vs-internal-CA cert probe lives in `infra/internal/tlsprobe/`. For the catalogue of every failure mode the recipe has tripped over (with detection signature + fix), see [`deploy-failure-modes.md`](deploy-failure-modes.md).

**Run `task doctor` first.** It validates PATH, BWS auth, and every required bootstrap secret before mutating anything — catches 90% of the bad-environment foot-guns below in <1s.

**`task up` errors with `BWS_ACCESS_TOKEN missing`** — export it in your shell (e.g. `source ~/.secrets`) before running. That's the only env var the wrapper requires; everything else self-discovers (see Step 5).

**`task up` errors with `INFRA_X missing in BWS`** — that secret hasn't been populated. Add it with `bws secret create INFRA_X <value> $(bws project list -o json | jq -r '.[]|select(.name=="iedora-deploy")|.id') -o none`.

**Tofu plan fails with "unable to parse docker host"** — the Hetzner box hasn't been provisioned yet; the `kreuzwerker/docker` provider is connecting too early. `iedora iac apply`'s targeted Pass 1 handles this. If hit directly: `tofu apply -target=hcloud_server.iedora` first.

**`ssh root@<hetzner-ip>` asks for a password** — `~/.ssh/id_ed25519.pub` wasn't registered as `hcloud_ssh_key.operator`. Check `tofu state list | grep hcloud_ssh_key` and re-apply.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages`. Re-run step 2. Or `INFRA_GHCR_TOKEN` in BWS is expired — regenerate the classic PAT and `bws secret edit` it.

**`menu.iedora.com` returns 530 / connection refused** — A record resolves but TLS fails. Either `infra-caddy` is down (`ssh root@$HOST docker logs -f infra-caddy`) or `infra-menu-web` isn't running (`ssh root@$HOST docker ps | grep menu`). Stage 4 deploys the container; rerun `task deploy:menu` if it's missing. Caddy returns 502 between deploys — that's expected.

**`Environment validation failed` on menu container start** — `SKIP_ENV_VALIDATION=1` is set during `next build` so Zod's `MENU_SESSION_SECRET` / `ZITADEL_*` checks don't fire on placeholder values. Runtime env is composed by Stage 4's `dockerOnHetzner` runtime from BWS values (Stage 3's Zitadel outputs + AUTOGEN secrets) + Tofu outputs. If a key is missing in BWS or Tofu output, `task deploy:menu` fails BEFORE the container starts with a clear "BWS missing X" or "tofu output X empty" error.

**Migrations fail in Stage 3** — `task app:apply` log shows the drizzle output. Common causes: DB unreachable (`task bws -- ssh root@$HOST docker logs infra-postgres`), schema conflict (manual fix via `task bws -- ssh -t root@$HOST docker exec -it infra-postgres psql -U postgres menu`), or stale image (`MENU_IMAGE_SHA=<correct-sha> task app:apply --only menu-db-migrations`).

**`unable to find image` on the server** — GHCR pull failed. `INFRA_GHCR_TOKEN` in BWS is wrong; regenerate. Or the image SHA in `MENU_IMAGE_SHA` doesn't exist in GHCR — verify with `gh release list` or `docker manifest inspect ghcr.io/eduvhc/menu:<sha>`.

**`tofu destroy` prints `Warning: Resource Destruction Considerations` for `cloudflare_r2_bucket_cors`** — harmless. Cloudflare doesn't expose a separate delete endpoint; the subresource goes when its parent does. Tofu only removes it from local state.

**Zitadel `FirstInstance` never produces `zitadel-admin-sa.json`** — bootstrap volume has stale perms. Manual recovery: `bws secret delete` the 6 `INFRA_ZITADEL_*` keys + the `INFRA_ZITADEL_SA_KEY_JSON`, SSH in to `docker rm -f infra-zitadel{,-login}` + `psql -c 'DROP DATABASE zitadel WITH (FORCE); CREATE DATABASE zitadel;'` + `docker volume rm zitadel-bootstrap`, then `task infra:up && task app:apply`. The reconciler recreates everything from scratch. Confirm via `ssh root@$HOST docker logs -f infra-zitadel`.
