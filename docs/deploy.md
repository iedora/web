# Deploy — one `tofu apply` for the whole iedora estate

Edit one config file, run one command, the whole stack lives behind Cloudflare DNS + on-box Caddy TLS. Everything is Tofu-managed — the Hetzner VPS, every Cloudflare resource, the GitHub Actions config, and every Docker container on the box (including the menu app).

```
Internet → Cloudflare DNS (grey-cloud A records, no proxy/tunnel)
            ├─→ menu.iedora.com   → Hetzner :443 → infra-caddy → menu_web:3000
            ├─→ auth.iedora.com   → Hetzner :443 → infra-caddy → infra-zitadel:8080
            ├─→ obs.iedora.com    → Hetzner :443 → infra-caddy → infra-openobserve:5080
            └─→ assets.iedora.com → R2 bucket via custom domain
```

Reference target: Hetzner CPX22 (Falkenstein, x86_64, 2 vCPU / 4 GB / public IPv4). `infra/tofu/hetzner.tf` provisions it from scratch via the `hcloud` provider.

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

To reuse an existing box: skip `hcloud_server.iedora` from the apply and set `INFRA_ONPREM_HOST` in BWS to that IP.

> **Why root?** SSH-key-only root login is the canonical Docker-over-SSH path — `kreuzwerker/docker` shells out to system SSH, which honors `~/.ssh/config`. The non-root path requires NOPASSWD-sudo (same root blast radius without the simplicity).

## Step 5 — Clone, configure, populate BWS

```bash
git clone https://github.com/<you>/iedora.git
cd iedora
cp infra/.env.example infra/.env
```

All production secrets live in Bitwarden Secrets Manager. `infra/.env` holds only non-secret IDs + the BWS access token:

```bash
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_ZONE_ID=your-zone-id
GHCR_USER=eduvhc
BWS_ACCESS_TOKEN=0.…
BWS_PROJECT_ID=…uuid…
```

Install `bws`: `brew install bitwarden/tap/bws` or download from https://github.com/bitwarden/sdk-sm/releases. Then populate BWS:

```bash
source infra/.env
for KEY in INFRA_CLOUDFLARE_API_TOKEN INFRA_STATE_PASSPHRASE \
           INFRA_HCLOUD_TOKEN INFRA_GITHUB_API_TOKEN \
           INFRA_POSTGRES_PASSWORD INFRA_BACKUP_PASSPHRASE INFRA_GHCR_TOKEN \
           INFRA_KAMAL_SSH_PRIVATE_KEY \
           INFRA_ZITADEL_MASTERKEY INFRA_ZITADEL_FIRST_ADMIN_PASSWORD \
           INFRA_OPENOBSERVE_ROOT_USER_PASSWORD \
           MENU_AUTH_SECRET; do
  read -s -p "$KEY: " V && echo
  bws secret create "$KEY" "$V" "$BWS_PROJECT_ID" -o none
done
```

Generate random values with `openssl rand -hex 32`, except:
- `INFRA_CLOUDFLARE_API_TOKEN` — from step 3.
- `INFRA_HCLOUD_TOKEN` — Hetzner console → Security → API tokens (R/W).
- `INFRA_GHCR_TOKEN` — classic PAT with `write:packages` (see "Why classic" below).
- `INFRA_GITHUB_API_TOKEN` — fine-grained PAT scoped to the repo.
- `INFRA_KAMAL_SSH_PRIVATE_KEY` — contents of `~/.ssh/id_ed25519`. Name is a tombstone (Kamal-era); load-bearing across BWS / GH variables / rotation playbook. Don't rename.
- `INFRA_ZITADEL_MASTERKEY` — must be exactly 32 chars: `openssl rand -base64 24 | head -c 32`.

> **Why classic for GHCR.** Every other PAT is fine-grained; `INFRA_GHCR_TOKEN` stays classic because fine-grained + personal account + GHCR is GitHub's worst-supported combination — the Packages permission only reliably surfaces for org-scoped tokens with org-owned packages. Revisit if iedora moves into a GH org.

Keep `BWS_ACCESS_TOKEN` in your password manager — losing it means losing every other secret. `infra/.env` is gitignored.

## Step 6 — Deploy

```bash
just infra::deploy
```

A 3-pass dance, automated:

1. **Provision the VPS only.** The `kreuzwerker/docker` provider needs a concrete `host` IP at plan time. Skipped if the box exists.
2. **Full apply.** Cloudflare R2 buckets + DNS + GitHub Actions config + every `docker_container` (`infra-postgres`, `infra-backups`, `infra-openobserve`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `menu_web`). Tofu pulls each image via `data.docker_registry_image + docker_image + pull_triggers`.
3. **Zitadel SA-key bootstrap (FIRST run only).** Zitadel's FirstInstance step mints a service-account JSON key inside the `zitadel-bootstrap` volume; `just zitadel-fetch-sa-key` lifts it into BWS; a second apply lands `zitadel.tf` (org + project). Subsequent runs: no-op.

First time: 5–10 min. Subsequent applies: 30s–2 min (only containers with changed image digest or config redeploy; `menu_web` redeploys on every new GHCR push).

Verify: `https://menu.iedora.com/up` → `{"ok":true,"db":"ok"}`.

---

## Day-2 commands

```bash
just infra::deploy           # idempotent
just infra::logs <svc>       # tail logs (defaults to backups; `just infra::logs menu_web` for app)
just infra::console          # psql shell into Postgres
just infra::backup           # force a pg_dump now
just infra::restore          # restore latest dump (interactive)
just infra::destroy          # tear down VPS + every resource
just infra::wipe-postgres    # destructive — drops the data dir
just infra::rotate-secret X  # prompt-driven BWS rotation
```

All wrappers around `tofu` or direct `ssh`. The justfile loads `infra/.env` and runs each recipe through `bin/with-secrets`, which exports every BWS secret as `TF_VAR_*` aliases.

**No `migrate` recipe.** Migrations run on container start via the menu container's `cmd`. Drizzle's migrator takes a `pg_advisory_lock` so multiple replicas don't race.

**Rolling back to a previous image.** `INFRA_MENU_IMAGE_TAG=<sha> just infra::deploy`. Image SHAs are tagged by commit on every push to main. Brief downtime (~5–10s while Tofu recreates the container).

---

## Continuous deployment

Once the manual flow works end-to-end, every push to main rolls a new menu image automatically.

```
git push main
   └─► .github/workflows/menu.yml         (typecheck, lint, unit, security)
        └─► build + push image            (linux/arm64-or-amd64 → ghcr.io/eduvhc/menu:<sha>)
             └─► .github/workflows/infra-deploy.yml   (workflow_run on success)
                  ├─► tofu init
                  ├─► tofu apply -auto-approve
                  │   └─► docker_image.menu pull_triggers fires → docker_container.menu_web recreates
                  └─► curl https://menu.iedora.com/up   (smoke)
```

CI builds + pushes; Tofu pulls from GHCR on the box. The only SSH path in CI is the `kreuzwerker/docker` provider talking to the Hetzner daemon — uses `INFRA_KAMAL_SSH_PRIVATE_KEY` from GH Secrets.

### Tofu-managed GH config

Every GH Actions secret + variable is Tofu-managed via `infra/tofu/github.tf` (`integrations/github`'s `for_each` over a locals map). Set the BWS source, `just infra::deploy` reconciles GH from BWS.

| GH Secret | BWS source | Notes |
|---|---|---|
| `BWS_ACCESS_TOKEN` | `BWS_ACCESS_TOKEN` (passed as `TF_VAR_bws_access_token`) | Runner uses it to authenticate to BWS for every other secret |
| `INFRA_KAMAL_SSH_PRIVATE_KEY` | `INFRA_KAMAL_SSH_PRIVATE_KEY` | Runner writes to `~/.ssh/id_ed25519`; reaches the Hetzner box. Name is a tombstone — see secrets.md |
| `CLAUDE_CODE_OAUTH_TOKEN` | `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | Powers `.github/workflows/claude.yml` |

| GH Variable | Notes |
|---|---|
| `BWS_PROJECT_ID` | Same as local `.env` |
| `ONPREM_HOST` | Hetzner public IPv4; write-through to BWS as `INFRA_ONPREM_HOST` |
| `MENU_PUBLIC_HOSTNAME` | `menu.iedora.com` |
| `CLOUDFLARE_ACCOUNT_ID` | Same as local `.env` |
| `GHCR_USER` | `eduvhc` (falls back to `github.repository_owner`) |

**House workload token is auto-populated.** `just house::deploy` mints the narrow Workers token via Tofu and write-throughs to BWS as `INFRA_HOUSE_WORKERS_TOKEN`. Rotate via `just house::rotate-token` (never bare `tofu apply -replace=...`, or BWS goes stale).

### Manual operations

```bash
gh workflow run infra-deploy.yml                  # re-roll latest main
gh workflow run menu.yml --ref <branch>           # re-trigger menu CI on a branch
gh run watch                                      # tail the latest run
```

Rollback: `INFRA_MENU_IMAGE_TAG=<previous-good-sha> just infra::deploy` from a laptop.

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

- `infra/.env` → justfile `set dotenv-load` → visible to every `tofu` subprocess.
- App + infra secrets → `bin/with-secrets` extracts from BWS, exports as `TF_VAR_*` aliases → Tofu reads them as variable inputs → sets them as container env in `docker_container.menu_web.env` (or the matching infra container).
- Registry pull → `docker_registry_image.menu` uses `INFRA_GHCR_TOKEN` as registry auth.

Every secret has exactly one source (BWS), one consumer (Tofu resource or container env), zero hops where a human pastes a value between systems.

---

## Why one Tofu root per blast-radius unit

The shared root (`infra/`) owns every cross-product resource AND the menu app container. Per-product roots (`products/menu/infra/tofu/`, `products/house/infra/tofu/`) own only product-local resources — for menu, the assets R2 bucket + `assets.iedora.com`; for house, the narrow `workers_deploy` token.

1. **Blast radius.** A typo in `products/house/infra/tofu/` literally cannot plan a change against the menu container — the state isn't there.
2. **Lifecycles.** The menu container changes per-push; the assets bucket changes once a quarter.
3. **Secrets surface.** The narrow `workers_deploy` token lives only in the house state.

Cost: ~30 lines duplicated per root (versions.tf, credentials, `data.cloudflare_zone "this"` lookup).

---

## Troubleshooting

**`just infra::deploy` errors with `key not found`** — `infra/.env` is missing or a required key isn't filled. Copy `.env.example` and fill it.

**Tofu plan fails with "unable to parse docker host"** — the Hetzner box hasn't been provisioned yet; the `kreuzwerker/docker` provider is connecting too early. Pass 1 of the recipe handles this. If you hit it directly: `tofu apply -target=hcloud_server.iedora` first.

**`ssh root@<hetzner-ip>` asks for a password** — `~/.ssh/id_ed25519.pub` wasn't registered as `hcloud_ssh_key.operator`. Check `tofu state list | grep hcloud_ssh_key` and re-apply.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages`. Re-run step 2. Or `INFRA_GHCR_TOKEN` in BWS is expired — regenerate the classic PAT and `bws secret edit` it.

**`menu.iedora.com` returns 530 / connection refused** — A record resolves but TLS fails. Either `infra-caddy` is down (`just infra::logs caddy`) or `menu_web` is unhealthy (`just infra::logs menu_web`). The healthcheck is canonical — `docker inspect menu_web --format '{{.State.Health.Status}}'` over SSH.

**Healthcheck flaps on first deploy** — app starts slower than the configured `interval`. Raise it in `infra/tofu/containers.tf` (the `healthcheck` block on `docker_container.menu_web`).

**`unable to find image` on the server** — GHCR pull failed. `INFRA_GHCR_TOKEN` in BWS is wrong; regenerate.

**Build-time warnings about `BETTER_AUTH_SECRET`** — Better Auth reads `process.env` during `next build`. `products/menu/infra/Dockerfile` sets placeholder build-only values; runtime values from container env override. If warnings come back after a Dockerfile change, re-add the placeholder `ENV` lines before `RUN node --run build`.

**`tofu destroy` prints `Warning: Resource Destruction Considerations` for `cloudflare_r2_bucket_cors`** — harmless. Cloudflare doesn't expose a separate delete endpoint; the subresource goes when its parent does. Tofu only removes it from local state.

**Zitadel `FirstInstance` never produces `zitadel-admin-sa.json`** — bootstrap volume has stale perms. `just infra::zitadel-rebootstrap` wipes + retries. Confirm via `just infra::logs zitadel`.
