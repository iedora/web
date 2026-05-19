# Deploy — one `tofu apply` for the whole iedora estate

End-to-end self-host: edit one config file, run one command, the whole stack live behind Cloudflare TLS. Everything is Tofu-managed — the Hetzner VPS, every Cloudflare resource, the GitHub Actions config, and every Docker container on the box (including the menu app itself). The only "script" is `infra/justfile` (run via `just infra::<recipe>` from anywhere in the repo).

```
Internet → Cloudflare edge (TLS)
            ├─→ menu.iedora.com         (grey-cloud A record) → Hetzner :443
            │                                                 → infra-caddy → menu_web:3000
            ├─→ auth.iedora.com         (grey-cloud A record) → Hetzner :443
            │                                                 → infra-caddy → infra-zitadel:8080
            ├─→ obs.iedora.com          → Cloudflare Tunnel    → infra-openobserve:5080
            └─→ assets.iedora.com       → R2 bucket via custom domain
```

The flow works on any cloud VPS with root SSH and a sane Docker install. The Hetzner CAX11 (ARM, Ampere Altra, 2 vCPU / 4 GB / €3.79/mo) is the reference target — `infra/tofu/hetzner.tf` provisions it from scratch via the `hcloud` provider.

---

## Step 1 — Local prerequisites (one-time, ever)

```bash
# macOS
brew install opentofu gh just
brew install --cask orbstack             # or docker desktop — anything that runs docker
gh auth login

# Linux
curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method standalone
curl -fsSL https://get.docker.com | sh
sudo apt install -y gh
gh auth login
```

Verify: `tofu version`, `docker info`, `gh auth status`. All should succeed.

---

## Step 2 — One-time GitHub Container Registry scope

```bash
gh auth refresh -s write:packages
```

CI pushes the built menu image to `ghcr.io/<your-github-username>/menu`. Scope is per-token, not per-package — do it once, ever.

---

## Step 3 — One-time Cloudflare prep

You need an existing zone (a domain you control, like `iedora.com`, added to your Cloudflare account). Create a scoped API token:

1. `dash.cloudflare.com` → top-right profile → **API Tokens** → **Create Custom Token**
2. Permissions:
   - **Account · Cloudflare Tunnel · Edit** (the obs.iedora.com tunnel)
   - **Zone · DNS · Edit** (scope to the specific zone)
   - **Account · Account Settings · Read**
   - **Account · Workers R2 Storage · Edit** (backups + menu assets buckets)
   - **User · API Tokens · Edit** (Tofu mints the R2 sub-tokens)
3. Copy the token into BWS as `INFRA_CLOUDFLARE_API_TOKEN`.

Also grab your **Account ID** and **Zone ID** from the right sidebar.

---

## Step 4 — Provision the box

The Hetzner VPS is provisioned by Tofu itself — you don't pre-create the box. Tofu only needs your `hcloud` API token (`INFRA_HCLOUD_TOKEN` in BWS) and an SSH public key on your laptop.

If you don't already have a keypair on your dev machine:

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

Tofu reads `~/.ssh/id_ed25519.pub`, registers it as `hcloud_ssh_key.operator`, and seeds it into `/root/.ssh/authorized_keys` on the freshly minted CAX11. After the first `just infra::deploy`, `ssh root@<hetzner-ipv4>` works immediately.

For a cloud VPS that's NOT Hetzner (or an existing box you want to reuse): skip `hcloud_server.iedora` from the apply and set `INFRA_ONPREM_HOST` in BWS to your existing IP. The `kreuzwerker/docker` provider will SSH-attach to whatever's there.

> **Why root?** SSH-key-only root login is the canonical Docker-over-SSH path — `kreuzwerker/docker` shells out to system SSH, which honors `~/.ssh/config`. The non-root path requires NOPASSWD-sudo (same root blast radius without the simplicity). Key-only root login is what cloud images ship with by default.

---

## Step 5 — Clone, configure, populate Bitwarden Secrets Manager

```bash
git clone https://github.com/<you>/iedora.git
cd iedora
cp infra/.env.example infra/.env
```

All production secrets live in Bitwarden Secrets Manager. `infra/.env` holds only non-secret IDs + the BWS access token that unlocks the vault:

```bash
# Cloudflare (from step 3)
CLOUDFLARE_ACCOUNT_ID=your-account-id-from-dashboard
CLOUDFLARE_ZONE_ID=your-zone-id-from-dashboard

# Your GitHub username — image will be pushed to ghcr.io/<this>/menu
GHCR_USER=eduvhc

# Bitwarden Secrets Manager: vault.bitwarden.com/#/sm → New project "iedora-deploy",
# new Machine account with R/W on the project, new access token.
BWS_ACCESS_TOKEN=0.…
BWS_PROJECT_ID=…uuid…
```

Then populate BWS with the bootstrap secrets. `bws` CLI install: `brew install bitwarden/tap/bws` on macOS or download from https://github.com/bitwarden/sdk-sm/releases.

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

Generate each random value with `openssl rand -hex 32`, except: `INFRA_CLOUDFLARE_API_TOKEN` (from step 3); `INFRA_HCLOUD_TOKEN` (Hetzner console → Security → API tokens → R/W); `INFRA_GHCR_TOKEN` (classic PAT, `write:packages` scope — see "Why classic for GHCR"); `INFRA_GITHUB_API_TOKEN` (fine-grained PAT scoped to the repo); `INFRA_KAMAL_SSH_PRIVATE_KEY` (the contents of `~/.ssh/id_ed25519` — kept under the historical `KAMAL_` name to avoid a churn-cascade through BWS / GH variables); `INFRA_ZITADEL_MASTERKEY` (must be exactly 32 chars — `openssl rand -base64 24 | head -c 32`).

> **Why the `INFRA_KAMAL_SSH_PRIVATE_KEY` name** — kept verbatim across the post-Kamal migration. It's load-bearing: GitHub Actions, BWS, the kreuzwerker/docker provider and the rotation playbook all reference this string. Renaming is a coordinated multi-system change with no upside. Treat the name as a tombstone.

**Why classic for GHCR (one declared exception to the fine-grained PAT preference).** Every other PAT in this stack is fine-grained — `INFRA_GITHUB_API_TOKEN` (Tofu repo config), etc. `INFRA_GHCR_TOKEN` is the exception, and stays classic because fine-grained PATs + personal accounts + GHCR is GitHub's worst-supported auth combination today: the "Packages" permission only reliably surfaces in the UI for org-scoped tokens with org-owned packages. Classic PAT with `write:packages` sidesteps the issue. Revisit if iedora ever moves into a GH org.

Keep the BWS access token in your password manager — losing it means losing access to every other secret. `infra/.env` is gitignored.

---

## Step 6 — Deploy

```bash
just infra::deploy
```

That's it. The recipe is a 3-pass dance, automated:

1. **Pass 1 — provision the Hetzner VPS only.** The `kreuzwerker/docker` provider needs a concrete `host` IP at plan time; while `hcloud_server.iedora.ipv4_address` is `(known after apply)` the full apply fails with "unable to parse docker host". Skipped if the box already exists.
2. **Pass 2 — full apply.** Cloudflare R2 buckets + obs tunnel + GitHub Actions config + every `docker_container.infra-*` (postgres, backups, openobserve, openobserve-tunnel, zitadel, zitadel-login, caddy) + `docker_container.menu_web`. Tofu pulls each image lazily via `data.docker_registry_image + docker_image + pull_triggers` — for `menu_web` that pulls the latest GHCR digest.
3. **Pass 3 — bootstrap the Zitadel SA key (FIRST run only).** Zitadel's FirstInstance step mints a service-account JSON key inside the `zitadel-bootstrap` volume; `just zitadel-fetch-sa-key` lifts it into BWS, then a second apply lands the zitadel TF resources (org import + project create). On subsequent runs, the SA key already lives in BWS and pass 3 is a no-op.

Total time: **5–10 min** the first time. Subsequent applies are 30s–2min (each `infra-*` container only redeploys if its image digest or config changed; `menu_web` redeploys whenever a new image is pushed).

When it finishes, hit `https://menu.iedora.com/up` — should return `{"ok":true,"db":"ok"}`.

---

## Day-2 commands

Run from the repo root:

```bash
just infra::deploy           # idempotent — same recipe day-1 and day-N
just infra::logs <svc>       # tail logs (defaults to backups; `just infra::logs menu_web` for the app)
just infra::console          # psql shell into the live Postgres container
just infra::backup           # force a pg_dump now (cron runs daily)
just infra::restore          # restore latest dump (interactive)
just infra::destroy          # tofu destroy — tears down the Hetzner VPS + everything
just infra::wipe-postgres    # destructive — drops the data dir on the host (use after `infra::destroy`)
just infra::rotate-secret X  # prompt-driven BWS secret rotation
```

All are wrappers around `tofu` or direct `ssh` calls. The justfile loads `infra/.env` (`set dotenv-load`) and runs each recipe through `bin/with-secrets`, which exports every BWS secret as `TF_VAR_*` aliases so Tofu sees them as variable inputs.

**Why no `migrate` recipe?** Migrations run on container start via the menu container's `cmd`. Drizzle's migrator takes a `pg_advisory_lock` so multiple replicas don't race; with one replica it's a one-shot.

**Rolling back to a previous image** is `INFRA_MENU_IMAGE_TAG=<sha> just infra::deploy` (the variable threads into `docker_container.menu_web.image`). Image SHAs are tagged in GHCR by commit SHA on every push to main. Brief downtime (~5–10s while Tofu recreates the container) is acceptable pre-customer; once a customer cares, switch to the canonical `kamal-proxy` / `Caddy upstream switch` pattern.

---

## Continuous deployment via GitHub Actions

Once the manual flow above works end-to-end, every push to main rolls a new menu image automatically. **Push to `main` → Menu CI runs → green Menu CI triggers `infra-deploy.yml` → Tofu pulls the new image and rolls `menu_web`.** Local `just infra::deploy` keeps working unchanged — the escape hatch for first-time setup, Tofu changes, and debugging.

### How it's wired

```
git push main
   └─► .github/workflows/menu.yml         (typecheck, lint, unit, security)
        └─► build + push image            (linux/arm64 → ghcr.io/eduvhc/menu:<sha>)
             └─► .github/workflows/infra-deploy.yml   (workflow_run: on success)
                  ├─► tofu init
                  ├─► tofu apply -auto-approve
                  │   └─► docker_image.menu pull_triggers fires → docker_container.menu_web recreates
                  └─► curl https://menu.iedora.com/up   (smoke)
```

No SSH from CI for image build (CI does buildx + push to GHCR; Tofu pulls from GHCR on the box). The only SSH path in CI is the `kreuzwerker/docker` provider talking to the Hetzner Docker daemon during `tofu apply` — that uses `INFRA_KAMAL_SSH_PRIVATE_KEY` from GH Secrets, written to `~/.ssh/id_ed25519` on the runner.

House is simpler — `house-deploy.yml` is direct `push` paths-filtered → `cloudflare/wrangler-action@v3`. No Tofu, no SSH, no GHCR.

### One-time GitHub config (per repo)

Every GH Actions secret + variable is Tofu-managed via `infra/tofu/github.tf` — the `integrations/github` provider's `for_each` over a locals map. You never run `gh secret set` directly; you set the BWS source value, then `just infra::deploy` reconciles GH from BWS.

| Tofu-managed GH Secret | Source in BWS | Notes |
|---|---|---|
| `BWS_ACCESS_TOKEN` | `BWS_ACCESS_TOKEN` (lives in `.env`, passed to Tofu via `TF_VAR_bws_access_token`) | The runner uses it to authenticate to BWS for every other secret |
| `KAMAL_SSH_PRIVATE_KEY` | `INFRA_KAMAL_SSH_PRIVATE_KEY` | The runner writes it to `~/.ssh/id_ed25519`; `kreuzwerker/docker` uses it to reach the Hetzner box |
| `CLAUDE_CODE_OAUTH_TOKEN` | `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | Powers `.github/workflows/claude.yml` |

| Tofu-managed GH Variable | Notes |
|---|---|
| `BWS_PROJECT_ID` | UUID — same as the local `.env` value |
| `ONPREM_HOST` | The Hetzner VPS public IPv4; written-through to BWS as `INFRA_ONPREM_HOST` by `just infra::deploy` |
| `MENU_PUBLIC_HOSTNAME` | `menu.iedora.com` |
| `CLOUDFLARE_ACCOUNT_ID` | Same as the local `.env` value |
| `GHCR_USER` | `eduvhc` (optional — falls back to `github.repository_owner`) |

**House workload token is auto-populated.** `just house::deploy` (locally, on first run) mints the narrow Workers workload token via Tofu and write-throughs it to BWS as `INFRA_HOUSE_WORKERS_TOKEN`. CI reads from BWS — no Tofu in CI. Rotate via `just house::rotate-token` (NEVER bare `tofu apply -replace=...`, or BWS goes stale and CI fails with 401).

### Minting the CI SSH key

The CI runner's SSH key is the same `~/.ssh/id_ed25519` you provisioned the Hetzner box with — written into BWS as `INFRA_KAMAL_SSH_PRIVATE_KEY`. If you want a dedicated CI-only keypair (smaller blast radius if a GH secret leaks):

```bash
# 1. Mint a fresh keypair on your laptop. Empty passphrase — non-interactive use.
ssh-keygen -t ed25519 -N "" -f ~/.ssh/ci_ed25519 -C "ci@iedora-$(date +%Y%m%d)"

# 2. Authorize the public half on root@<hetzner-ip>.
ssh-copy-id -i ~/.ssh/ci_ed25519.pub root@$(bws secret get-by-key INFRA_ONPREM_HOST "$BWS_PROJECT_ID" -o env | cut -d= -f2-)

# 3. Push the private half into BWS (Tofu reconciles GH from BWS on the next apply).
bws secret edit "$(bws secret list "$BWS_PROJECT_ID" -o json | jq -r '.[] | select(.key=="INFRA_KAMAL_SSH_PRIVATE_KEY") | .id')" --value "$(cat ~/.ssh/ci_ed25519)" -o none

just infra::deploy   # propagates the new key to the GH secret
```

To rotate later: regenerate, ssh-copy-id the new one, BWS edit, `just infra::deploy`, then remove the old line from `/root/.ssh/authorized_keys` on the box.

### Manual operations

```bash
gh workflow run infra-deploy.yml                  # re-roll latest main
gh workflow run menu.yml --ref <branch>           # re-trigger Menu CI on a branch
gh run watch                                      # tail the latest run
```

Rollback: `INFRA_MENU_IMAGE_TAG=<previous-good-sha> just infra::deploy` from a laptop. Image SHAs are still in GHCR, tagged by commit SHA.

### Caching map

| Layer | Where | Key | Hit rate |
|---|---|---|---|
| Bun install (`~/.bun/install/cache`) | composite `setup/action.yml` | `bun-<os>-<bun.lock hash>` | ~95% |
| Next/Turbopack (`.next/cache`) | `menu.yml` build job | `next-menu-<os>-<bun.lock + next.config.ts>` | ~90% |
| Docker buildx layers | `menu.yml` build job | `type=gha,mode=max,scope=menu` | ~80% |

GHA caches are per-branch with base-branch fallback, evicted after 7 days untouched, capped at 10 GiB per repo.

### When NOT to use CI for deploy

- **First-ever setup on a fresh laptop.** Bootstrapping BWS + the bootstrap CF token + the Hetzner box is local-only. Once `just infra::deploy` works once locally, CI takes over.
- **Tofu changes.** `infra-deploy.yml` DOES run `tofu apply`, but you should rehearse a substantial Tofu change locally first (you'd see the plan; CI auto-approves). Editing `.tf` and pushing without a local rehearsal is fine for small, reviewed changes (image tag bumps, container env additions).
- **Anything destructive.** `tofu destroy`, `wipe-postgres`, `zitadel-rebootstrap` — local only. The CI flow is one-way (forward apply + smoke check).

### Supply-chain verification on a deployed image

Every successful `menu.yml` build mints two Sigstore-signed attestations attached to the GHCR image: SLSA build provenance + SBOM. Verify them client-side without needing repo metadata:

```bash
gh attestation verify oci://ghcr.io/eduvhc/menu:<sha> --owner eduvhc
gh attestation verify oci://ghcr.io/eduvhc/menu:<sha> --owner eduvhc --type sbom
```

Verification failures = either the image is from outside our CI (stolen GHCR push token), the registry returned the wrong content, or attestations were stripped. The post-deploy Trivy image scan + SARIF upload populates the Security tab with any CVE findings — see `docs/security-audit.md`.

---

## How values flow

- **`infra/.env`** → justfile `set dotenv-load` → visible to every `tofu` subprocess that the recipe spawns.
- **App + infra secrets** (`MENU_AUTH_SECRET`, `INFRA_POSTGRES_PASSWORD`, etc.) → `bin/with-secrets` extracts them from BWS by key name, then exports them as `TF_VAR_*` aliases that Tofu reads as variable inputs. Tofu sets them as container env in `docker_container.menu_web.env` (or the matching infra container).
- **Registry pull** → `docker_registry_image.menu` uses `INFRA_GHCR_TOKEN` (from BWS) as the registry auth.
- **Tunnel tokens** → minted by Tofu inside `module.observability_tunnel`; flow directly into the corresponding `docker_container.*-tunnel.env`. No manual copy step.

The full chain is declarative end-to-end: every secret has exactly one source (BWS), one consumer (a Tofu resource or container env), and zero hops where a human pastes a value between systems.

---

## Updating the menu hostname / adding routes

`infra/tofu/main.tf` and `infra/tofu/containers.tf` together own menu's DNS + ingress. `menu.iedora.com` is a direct A record (grey cloud) pointing at the Hetzner IPv4; the box terminates TLS via `infra-caddy` and reverse-proxies to `menu_web:3000`. To add a new public hostname (e.g. a marketing subdomain that bypasses the app): add a `cloudflare_dns_record` in `main.tf` and a matching Caddy route in `infra/postgres/Caddyfile` (or the per-service one) and `just infra::deploy`.

The brand-level iedora.com site (Astro on Workers Static Assets) is a separate root (`products/house/infra/tofu/`) with its own state and own deploy recipe (`just house::deploy`).

---

## Why one Tofu root per blast-radius unit

The shared root (`infra/`) owns every cross-product resource AND the menu app container. Per-product roots (`products/menu/infra/tofu/`, `products/house/infra/tofu/`) own only product-local resources — for menu, that's the assets R2 bucket + `assets.iedora.com`; for house, the narrow `workers_deploy` token.

1. **Blast radius.** A typo in `products/house/infra/tofu/` literally cannot plan a change against the menu container — the state isn't there.
2. **Lifecycles.** The menu container changes per-push; the assets bucket changes once a quarter. Splitting state means routine container rolls don't even read the bucket config.
3. **Secrets surface.** The narrow `workers_deploy` token (see `docs/secrets.md` — Token tiers) lives only in the house state.

The cost: ~30 lines duplicated per root (versions.tf, the credentials each root happens to need, a `data.cloudflare_zone "this"` lookup). The Terraform monorepo articles all call this out as the trade-off; the alternative (one root, multiple `.tf` files, shared state) puts everything inside one blast radius.

---

## Why `just` (not Make)

The entry point is `<repo>/justfile`, a tiny forwarder that uses `mod infra 'infra'` + `mod menu 'products/menu/infra'` + `mod house 'products/house/infra'` to expose per-workspace recipes as `just infra::deploy` / `just menu::infra` / `just house::deploy`. Switched from Make in May 2026 for three reasons:

1. **Modules.** `just` has first-class module support — adding a new workspace is one line in the root forwarder.
2. **Auto-help.** `just` (no args) lists every recipe with the comment line above it as the description.
3. **No escape pain.** Shebang recipes (`#!/usr/bin/env bash`) let multi-step recipes be plain bash scripts.

Install: `brew install just` (macOS) or `cargo install just` (Linux).

---

## File structure

```
.env.example                                      dev template — copy to .env.local (Next.js dev)
infra/.env.example                                infra template — copy to infra/.env (Tofu; NOT loaded by Next)
infra/justfile                                    every infra recipe (deploy, backup, restore, …)
infra/bin/with-secrets                            BWS wrapper — exports every secret as TF_VAR_*
infra/tofu/                                       shared Tofu root (encrypted state)
  versions.tf                                     providers: hcloud, cloudflare, github, kreuzwerker/docker
  hetzner.tf                                      hcloud_server.iedora + firewall + SSH key
  containers.tf                                   every docker_container (infra-* accessories + menu_web)
  main.tf                                         Cloudflare R2 + obs tunnel + DNS (menu.iedora.com, auth.iedora.com)
  github.tf                                       integrations/github — every GH Actions secret/variable
  zitadel.tf                                      zitadel orgs/projects (lands after SA key bootstrap)
products/menu/infra/Dockerfile                    multi-stage build for the menu app (Bun install, Node build, standalone)
products/menu/infra/tofu/                         menu's assets bucket + assets.iedora.com (encrypted state)
products/house/infra/tofu/                        iedora.com — narrow workers_deploy token (encrypted state)
```

---

## Troubleshooting

**`just infra::deploy` errors with `key not found` early on** — `infra/.env` is missing or a required key isn't filled. Copy `infra/.env.example` and fill in every value.

**Tofu plan fails with "unable to parse docker host"** — the Hetzner box hasn't been provisioned yet, but the `kreuzwerker/docker` provider is trying to connect anyway. This is what Pass 1 of the deploy recipe handles automatically. If you hit it directly (running raw `tofu apply`), run `tofu apply -target=hcloud_server.iedora` first, then a full apply.

**`ssh root@<hetzner-ip>` asks for a password** — `~/.ssh/id_ed25519.pub` wasn't registered as `hcloud_ssh_key.operator`. Check `tofu state list | grep hcloud_ssh_key` and re-apply.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages` in the scopes line. Re-run step 2. Or `INFRA_GHCR_TOKEN` in BWS is expired — regenerate the classic PAT and `bws secret edit` it.

**`menu.iedora.com` returns 530 / connection refused** — symptom: the A record resolves but TLS fails. Root cause: either `infra-caddy` is down (`just infra::logs caddy`) or `menu_web` is unhealthy (`just infra::logs menu_web`). The container's healthcheck is the canonical signal — `docker inspect menu_web --format '{{.State.Health.Status}}'` over SSH.

**Healthcheck flaps on first deploy** — the app starts slower than the configured `interval`. Raise it in `infra/tofu/containers.tf` (the `healthcheck` block on `docker_container.menu_web`).

**`unable to find image` on the server** — GHCR pull failed. `INFRA_GHCR_TOKEN` in BWS is wrong; regenerate the classic PAT.

**Build-time warnings about `BETTER_AUTH_SECRET`** — Better Auth reads `process.env` during `next build`. `products/menu/infra/Dockerfile` sets placeholder values for build-only; runtime values from Tofu's container env override them. If warnings come back after a Dockerfile change, the placeholders got removed — re-add the `ENV BETTER_AUTH_SECRET=…` / `ENV BETTER_AUTH_URL=…` lines before `RUN node --run build`.

**`tofu destroy` prints `Warning: Resource Destruction Considerations` for `cloudflare_zero_trust_tunnel_cloudflared_config` and `cloudflare_r2_bucket_cors`** — harmless, expected, no action needed. The Cloudflare provider can't delete these two resource types via API because Cloudflare doesn't expose a separate delete endpoint — they're subresources of their parents (the tunnel and the bucket respectively), deleted automatically when the parent goes. Tofu only removes them from local state.

**Zitadel `FirstInstance` step never produces `zitadel-admin-sa.json`** — the bootstrap volume has stale perms from a previous attempt. Run `just infra::zitadel-rebootstrap` to wipe + retry. Confirms via `just infra::logs zitadel`.
