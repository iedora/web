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
just infra::deploy
```

A 3-pass dance, automated:

1. **Provision the VPS only.** The `kreuzwerker/docker` provider needs a concrete `host` IP at plan time. Skipped if the box exists.
2. **Full apply.** Cloudflare R2 buckets + DNS + GitHub Actions config + every `docker_container` (`infra-postgres`, `infra-backups`, `infra-openobserve`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `menu_web`). The menu image is SHA-pinned via `TF_VAR_menu_image_sha` (defaults to `latest` for first bootstrap; CI passes `${{ github.sha }}` thereafter). A new SHA changes `docker_image.menu`'s `name`, forcing replacement of the image AND the container that references it.
3. **Zitadel SA-key bootstrap (FIRST run only).** Zitadel's FirstInstance step mints a service-account JSON key inside the `zitadel-bootstrap` volume; `just zitadel-fetch-sa-key` lifts it into BWS; a second apply lands `zitadel.tf` (org + project). Subsequent runs: no-op.

First time: 5–10 min. Subsequent applies: 30s–2 min (only containers with changed image digest or config redeploy; `menu_web` redeploys on every new SHA passed via `image_sha`).

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

All wrappers around `tofu` or direct `ssh`. Each recipe runs through `bin/with-secrets`, which needs only `BWS_ACCESS_TOKEN` in your shell — `BWS_PROJECT_ID` is discovered via `bws project list`, `CLOUDFLARE_ACCOUNT_ID` via CF's `/accounts` API, and every BWS secret is exported as a `TF_VAR_*` alias.

**No `migrate` recipe.** Migrations run on container start via the menu container's `cmd`. Drizzle's migrator takes a `pg_advisory_lock` so multiple replicas don't race.

**Rolling back to a previous image.** `gh workflow run infra-deploy.yml --field image_sha=<older-sha>`. Image SHAs are tagged by commit on every push to main; the workflow input flows in as `TF_VAR_menu_image_sha`. Brief downtime (~5–10s while Tofu recreates the container).

---

## Continuous deployment

Once the manual flow works end-to-end, every push to main rolls a new menu image automatically.

```
git push main
   └─► .github/workflows/menu.yml         (typecheck, lint, unit, security)
        └─► build + push image            (linux/amd64 → ghcr.io/eduvhc/menu:<sha>)
             └─► gh workflow run infra-deploy.yml --field image_sha=${{ github.sha }}
                  ├─► tofu init                            (decrypts state via INFRA_STATE_PASSPHRASE)
                  ├─► tofu apply -auto-approve
                  │   └─► docker_image.menu name changes → force-replace → docker_container.menu_web recreates
                  └─► curl https://menu.iedora.com/up   (smoke)
```

CI builds + pushes; Tofu pulls from GHCR on the box. The only SSH path in CI is the `kreuzwerker/docker` provider talking to the Hetzner daemon — uses `INFRA_SSH_PRIVATE_KEY` from GH Secrets.

### Tofu-managed GH config

Every GH Actions secret + variable is Tofu-managed via `infra/tofu/github.tf` (`integrations/github`'s `for_each` over a locals map). Set the BWS source, `just infra::deploy` reconciles GH from BWS.

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

- `BWS_ACCESS_TOKEN` (shell env) → `bin/with-secrets` calls `bws project list` to pick the `iedora-deploy` project, then `bws secret list` to load every `INFRA_*` secret into env.
- `INFRA_CLOUDFLARE_API_TOKEN` (loaded above) → wrapper calls CF `/accounts` API → `CLOUDFLARE_ACCOUNT_ID` exported as `TF_VAR_account_id`.
- All other BWS secrets → exported as `TF_VAR_*` aliases → Tofu reads them as variable inputs → sets them as container env in `docker_container.menu_web.env` (or the matching infra container).
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

> **Where the deploy logic lives.** The `just infra::deploy`/`destroy`/`doctor` recipes are 1-line shims into `infra/cmd/iedora/` — a Go orchestrator with unit tests under `*_test.go`. Pass 1/2/3 logic, the DNS-override CONNECT proxy that sidesteps the macOS NXDOMAIN cache, and the Let's-Encrypt-vs-internal-CA cert probe all live there. For the catalogue of every failure mode the recipe has tripped over (with detection signature + fix), see [`tasks/deploy-fluency/failure-modes.md`](../tasks/deploy-fluency/failure-modes.md).

**Run `just infra::doctor` first.** It validates PATH, BWS auth, and every required bootstrap secret before mutating anything — catches 90% of the bad-environment foot-guns below in <1s.

**`just infra::deploy` errors with `BWS_ACCESS_TOKEN missing`** — export it in your shell (e.g. `source ~/.secrets`) before running. That's the only env var the wrapper requires; everything else self-discovers (see Step 5).

**`just infra::deploy` errors with `INFRA_X missing in BWS`** — that secret hasn't been populated. Add it with `bws secret create INFRA_X <value> $(bws project list -o json | jq -r '.[]|select(.name=="iedora-deploy")|.id') -o none`.

**Tofu plan fails with "unable to parse docker host"** — the Hetzner box hasn't been provisioned yet; the `kreuzwerker/docker` provider is connecting too early. Pass 1 of the recipe handles this. If you hit it directly: `tofu apply -target=hcloud_server.iedora` first.

**`ssh root@<hetzner-ip>` asks for a password** — `~/.ssh/id_ed25519.pub` wasn't registered as `hcloud_ssh_key.operator`. Check `tofu state list | grep hcloud_ssh_key` and re-apply.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages`. Re-run step 2. Or `INFRA_GHCR_TOKEN` in BWS is expired — regenerate the classic PAT and `bws secret edit` it.

**`menu.iedora.com` returns 530 / connection refused** — A record resolves but TLS fails. Either `infra-caddy` is down (`just infra::logs caddy`) or `menu_web` is unhealthy (`just infra::logs menu_web`). The healthcheck is canonical — `docker inspect menu_web --format '{{.State.Health.Status}}'` over SSH.

**Healthcheck flaps on first deploy** — app starts slower than the configured `interval`. Raise it in `infra/tofu/containers.tf` (the `healthcheck` block on `docker_container.menu_web`).

**`unable to find image` on the server** — GHCR pull failed. `INFRA_GHCR_TOKEN` in BWS is wrong; regenerate.

**`Environment validation failed` on container start** — `SKIP_ENV_VALIDATION=1` is set during `next build` so Zod's `MENU_SESSION_SECRET` / `ZITADEL_*` checks don't fire on placeholder values. Runtime env on `docker_container.menu_web` is populated directly from TF resources in the same root (`random_password.menu_session_secret`, `zitadel_application_oidc.menu`, `zitadel_personal_access_token.menu_sa`). If `local.zitadel_bootstrapped` is false (no SA key in BWS yet), the menu container is gated to `count = 0`. Check `just infra::logs menu_web` for the offending name.

**`tofu destroy` prints `Warning: Resource Destruction Considerations` for `cloudflare_r2_bucket_cors`** — harmless. Cloudflare doesn't expose a separate delete endpoint; the subresource goes when its parent does. Tofu only removes it from local state.

**Zitadel `FirstInstance` never produces `zitadel-admin-sa.json`** — bootstrap volume has stale perms. `just infra::zitadel-rebootstrap` wipes + retries. Confirm via `just infra::logs zitadel`.
