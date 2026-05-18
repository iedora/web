# Deploy — homelab box or cloud VPS behind a Cloudflare Tunnel

End-to-end self-host: edit one config file, run one command, app live behind a Cloudflare Tunnel with TLS. Kamal 2 does the heavy lifting; the only "script" is the `products/menu/infra/justfile` (run via `just X` from anywhere in the repo).

```
Internet → Cloudflare edge (TLS)
            ├─→ cloudflared accessory (outbound) → http://kamal-proxy → app:3000
            └─→ R2 bucket via custom domain      → assets.<your-zone>
```

The same flow works identically on a homelab Ubuntu box and a fresh cloud VPS (DigitalOcean, Hetzner, Linode, AWS). The only difference: cloud VPS images already ship with root SSH + your key; a homelab box needs the key copied to root once.

---

## Step 1 — Local prerequisites (one-time, ever)

Same tools on Mac and Linux; only the installers differ.

**macOS** (Apple Silicon or Intel):

```bash
brew install opentofu gh                 # IaC + GitHub CLI
sudo gem install kamal -N                # Kamal is a Ruby gem, not a brew formula
brew install --cask orbstack             # or docker desktop — anything that runs docker
gh auth login
```

**Linux** (Debian/Ubuntu shown; adapt for Fedora/Arch):

```bash
# Tofu — official installer (apt repos are stale)
curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method standalone

# Ruby + Kamal
sudo apt install -y ruby-full build-essential
sudo gem install kamal -N

# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# GitHub CLI — official repo (apt's gh is often outdated)
(type -p wget >/dev/null || sudo apt install -y wget) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list \
  && sudo apt update && sudo apt install -y gh
gh auth login
```

Verify each: `tofu version`, `kamal version`, `docker info`, `gh auth status`. All should succeed.

---

## Step 2 — One-time GitHub Container Registry scope

```bash
gh auth refresh -s write:packages
```

Kamal pushes the built image to `ghcr.io/<your-github-username>/menu` (and `…/genkan`). The scope is per-token, not per-package — do it once, ever. Confirm with `gh auth status` and look for `write:packages` in the scopes line.

---

## Step 3 — One-time Cloudflare prep

You need an existing zone (a domain you control, like `example.com`, added to your Cloudflare account). Then create a scoped API token:

1. `dash.cloudflare.com` → top-right profile → **API Tokens** → **Create Custom Token**
2. Add permissions:
   - **Account · Cloudflare Tunnel · Edit**
   - **Zone · DNS · Edit** (scope to the specific zone)
   - **Account · Account Settings · Read**
   - **Account · Workers R2 Storage · Edit** (Tofu manages the backups bucket)
   - **User · API Tokens · Edit** (Tofu creates the R2 S3 sub-token for the backups accessory)
3. Copy the token — you'll paste it into `products/menu/infra/.env`.

Also grab your **Account ID** and **Zone ID** from the right sidebar of any Cloudflare dashboard page.

---

## Step 4 — Provision the box

**Prerequisite: an SSH keypair on your dev machine.** If you don't already have one:

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

Then your public key is `~/.ssh/id_ed25519.pub`. View it with `cat ~/.ssh/id_ed25519.pub` — this is what you paste/copy in the two paths below.

**Cloud VPS (DigitalOcean / Hetzner / Linode / AWS):** when creating the droplet, paste the contents of `~/.ssh/id_ed25519.pub` into the "SSH keys" field. The image ships with `PermitRootLogin prohibit-password`, password auth off, your key in `/root/.ssh/authorized_keys`. **Nothing else to do** — `ssh root@<droplet-ip>` works immediately.

**Homelab box:** install Ubuntu 24.04+ Server, set up your sudo user during install (call them whatever — `eduardo`, `pwu`, etc.). Then from your dev machine:

```bash
# 4a. Install your SSH key for the sudo user (paste their password once).
ssh-copy-id <sudo-user>@<box-ip>

# 4b. Copy that key into /root/.ssh — this is the key Kamal will use.
ssh -t <sudo-user>@<box-ip> 'sudo install -d -m 700 -o root -g root /root/.ssh && sudo cp ~/.ssh/authorized_keys /root/.ssh/authorized_keys && sudo chown root:root /root/.ssh/authorized_keys && sudo chmod 600 /root/.ssh/authorized_keys'

# 4c. If Ubuntu's sshd disables root login entirely, flip it to "prohibit-password" (key-only, never "yes").
ssh -t <sudo-user>@<box-ip> 'sudo sed -i "s/^PermitRootLogin.*/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config && sudo systemctl reload ssh'

# 4d. Verify root SSH works with your key (should print "root" instantly, no password prompt).
ssh root@<box-ip> 'whoami'
```

> **Why root?** Kamal 2's canonical convention is `ssh.user: root` with **SSH-key-only** login. `kamal server bootstrap` curls `get.docker.com` which needs root; Kamal itself never runs `sudo`. The non-root path requires NOPASSWD-sudo (which has the same root blast radius without the simplicity). Key-only root login is what cloud images do by default — and is materially safer than NOPASSWD sudo. Keep your sudo human account for ad-hoc admin; Kamal's lane stays root-via-key.

---

## Step 5 — Clone, configure, populate Bitwarden Secrets Manager

```bash
git clone https://github.com/<you>/iedora.git
cd iedora
cp products/menu/infra/.env.example products/menu/infra/.env
```

All production secrets live in Bitwarden Secrets Manager. `products/menu/infra/.env` holds only non-secret IDs + the BWS access token that unlocks the vault:

```bash
# Cloudflare (from step 3)
CLOUDFLARE_ACCOUNT_ID=your-account-id-from-dashboard
CLOUDFLARE_ZONE_ID=your-zone-id-from-dashboard

# The hostname your app lives at (must be a subdomain of your Cloudflare zone)
PUBLIC_HOSTNAME=menu.example.com

# The box (cloud VPS public IP or homelab LAN IP). Kamal connects as root.
ONPREM_HOST=192.168.50.53

# Your GitHub username — image will be pushed to ghcr.io/<this>/menu
GHCR_USER=eduvhc

# Bitwarden Secrets Manager: vault.bitwarden.com/#/sm → New project "iedora-deploy",
# new Machine account with R/W on the project, new access token.
BWS_ACCESS_TOKEN=0.…
BWS_PROJECT_ID=…uuid…
```

Then populate BWS with 7 secrets — use the same machine to avoid pasting tokens around. `bws` CLI install: `brew install bitwarden/tap/bws` on macOS or download from https://github.com/bitwarden/sdk-sm/releases.

```bash
source products/menu/infra/.env
for KEY in INFRA_CLOUDFLARE_API_TOKEN INFRA_STATE_PASSPHRASE \
           INFRA_POSTGRES_PASSWORD INFRA_BACKUP_PASSPHRASE INFRA_GHCR_TOKEN \
           MENU_AUTH_SECRET GENKAN_AUTH_SECRET \
           MENU_OAUTH_CLIENT_ID MENU_OAUTH_CLIENT_SECRET; do
  read -s -p "$KEY: " V && echo
  bws secret create "$KEY" "$V" "$BWS_PROJECT_ID" -o none
done
```

Generate each value with `openssl rand -hex 32`, except `INFRA_CLOUDFLARE_API_TOKEN` (from step 3) and `INFRA_GHCR_TOKEN` (https://github.com/settings/tokens — classic PAT, `write:packages` scope). For `MENU_OAUTH_CLIENT_ID` / `MENU_OAUTH_CLIENT_SECRET`, generate fresh random values and remember them — they get seeded into genkan's `oauth_client` table by genkan's `migrate.mjs` on first boot (driven by `TRUSTED_CLIENTS`).

Keep the BWS access token in your password manager — losing it means losing access to every other secret. `products/menu/infra/.env` is gitignored.

---

## Step 6 — Deploy

```bash
just infra::deploy       # FIRST — boots shared Postgres + backups accessory
just menu::deploy        # then the products
just genkan::deploy
```

The order matters on a fresh box: menu and genkan both connect to `infra-postgres:5432`, so the infra workspace MUST boot first.

`just infra::deploy` runs:
1. **`tofu apply`** on `infra/tofu/` — creates the `iedora-backups` R2 bucket + its scoped R2 token.
2. **`kamal accessory boot all`** on `infra/kamal/` — boots `infra-postgres` + `infra-backups` accessories.

`just menu::deploy` (and the genkan equivalent) runs:
1. **`tofu apply`** on the product's `tofu/` — creates the Cloudflare Tunnel + ingress, DNS record, and (menu only) R2 assets bucket + its scoped token.
2. **`kamal setup`** — Kamal's idempotent first-time-or-anytime command:
   - `kamal server bootstrap` — installs Docker on the box if not already (no-op on subsequent runs).
   - `kamal accessory boot all` — boots the product's `cloudflared` accessory (no-op if already running).
   - `kamal deploy` — builds the image natively on the box (amd64, no QEMU on the Mac via `builder.remote`), pushes to GHCR, pulls on the box, starts the app container.

Each app container's start command is `node scripts/migrate.mjs && node server.js` — Drizzle migrations run under a `pg_advisory_lock` (safe across multiple replicas) before the server boots. Menu's migrate creates the `menu` database; genkan's creates `genkan`. Both connect to the shared `infra-postgres` server.

Total time: **5–10 min** the first time (cold image build for each product). Subsequent deploys are 1–2 min with the build cache.

When it finishes, hit `https://$PUBLIC_HOSTNAME/up` — should return `{"ok":true,"db":"ok"}`.

---

## Day-2 commands

Run from the repo root (or `cd products/menu/infra` and drop the `menu::` namespace):

```bash
just menu::deploy        # idempotent — tofu apply + kamal setup. Same on day-1 and day-N.
just menu::logs          # tail app logs (rolling)
just menu::console       # bash inside a fresh app container with env loaded
just menu::rollback      # roll back to the previous version
just infra::backup       # force a pg_dump now (cron runs daily)
just infra::restore      # restore latest dump (interactive)
just menu::destroy       # tofu destroy — removes the Cloudflare tunnel + DNS only; box untouched
```

All are direct `kamal` (or `tofu`) calls — the justfile loads `products/menu/infra/.env` (`set dotenv-load`), runs each recipe through `bin/with-secrets`, and resolves the gem-bin PATH so subprocesses find `kamal`.

**Why no `migrate` or `redeploy` recipe?** Migrations run on container start via the Kamal `servers.web.cmd` (`node scripts/migrate.mjs && node server.js`) — guarded by a pg_advisory_lock so multiple replicas don't race. And `redeploy` was just `deploy` minus a few idempotent steps (registry login, pruning); `deploy` itself is idempotent and only ~10s slower in the no-op case, so one verb is enough. Ad-hoc: `cd products/menu/infra/kamal && kamal app exec ...` for one-offs.

For ad-hoc kamal commands (e.g. `kamal app stop`, `kamal accessory exec`), source `products/menu/infra/.env` first:

```bash
set -a; . products/menu/infra/.env; set +a
kamal app stop
```

---

## Adding a second box / a cloud VPS later

Same five steps — only step 4 (provisioning) differs. For a cloud VPS, **nothing** is needed in step 4 because the image ships with root SSH already. For a second box, you'd typically use Kamal's multi-host config — bump `servers.web.hosts` in `products/menu/infra/kamal/config/deploy.yml` to a list, and Kamal load-balances behind kamal-proxy.

---

## How values flow

- **`products/menu/infra/.env`** → justfile `set dotenv-load` → visible to every `tofu`/`kamal` subprocess that the recipe spawns.
- **Tunnel token** → generated by `tofu apply` in `products/menu/infra/tofu/`, read at deploy time by `products/menu/infra/kamal/.kamal/secrets` via `$(tofu -chdir=../tofu output -raw tunnel_token)` (paths are relative to Kamal's cwd, `products/menu/infra/kamal/`). No manual copy step.
- **Registry password** → `$(gh auth token)` evaluated when Kamal logs into ghcr.io.
- **App + infra secrets** (`MENU_AUTH_SECRET`, `INFRA_POSTGRES_PASSWORD`, etc.) → `.kamal/secrets` extracts them by BWS key name via the `bitwarden-sm` adapter, then exposes them under the in-container env-var names the apps expect (e.g. `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`).

`.kamal/secrets` is checked into git — it contains **only references**, never values.

---

## Updating the Cloudflare tunnel (adding routes, etc.)

`products/menu/infra/tofu/menu.tf` defines ingress + DNS for the menu app. Edit it (e.g. add a third ingress rule for a new accessory), then `just menu::deploy` — `tofu apply` (against `tofu/menu/`) runs first and pushes the change. DNS + ingress propagate in seconds. The brand-level iedora.com site (Astro on Workers Static Assets) is a separate root (`products/house/infra/tofu/`) with its own state and own deploy recipe (`just house::deploy`).

---

## Why one Tofu root per product (and not one shared root)

Each product owns its own Tofu root under `products/<name>/infra/tofu/` with its own encrypted state file. The shared bits (Cloudflare provider, encryption envelope, zone data source) are duplicated per root — that's deliberate.

**The benefits paid for by that duplication:**

1. **Blast radius.** `tofu apply` in `products/house/infra/tofu/` literally cannot plan a change against the menu tunnel — the state isn't there. A typo in house resources can't accidentally destroy R2 buckets.
2. **Lifecycles.** The menu app changes weekly; the house site changes maybe once a quarter. Splitting state means routine menu deploys don't even read the house config, and a stuck Workers-custom-domain provisioning doesn't block `just menu::deploy`.
3. **Secrets surface.** The narrow `workers_deploy` token (see `docs/secrets.md` — Token tiers) lives only in the house state. wrangler reads it via `tofu -chdir=tofu output`, never seeing the menu tunnel or R2 keys.
4. **Adding a 3rd product is mechanical** — `mkdir products/<name>/`, copy the shape of `products/house/infra/` as a starting point, append `mod <name> 'products/<name>/infra'` to the root `justfile`. No edits to existing products.

**The cost.** ~30 lines duplicated per root: `versions.tf` (provider + encryption), `variables.tf` for the credentials each root happens to need (api_token, account_id, state_passphrase), and a `data.cloudflare_zone "this"` lookup. The Terraform monorepo articles ([Spacelift](https://spacelift.io/blog/terraform-monorepo), [Cloud Posse, Scalr]) all call this out as the trade-off the pattern asks for; the alternative (one root, multiple `.tf` files, shared state) puts everything inside one blast radius.

---

## Why `just` (not Make)

The entry point is `<repo>/justfile`, a tiny forwarder that uses `mod menu 'products/menu/infra'` + `mod house 'products/house/infra'` to expose per-product recipes as `just menu::deploy` / `just house::deploy` / etc. Each product has its own self-contained `infra/justfile`. Switched from Make in May 2026 for three reasons:

1. **Modules.** `just` has first-class module support — `mod <name> '<path>'` namespaces an entire justfile under a prefix. Adding a 3rd product is one line in the root forwarder; Make would need per-target forwarders or a parameterized convention that gets brittle fast.
2. **Auto-help.** `just` (no args) lists every recipe with the comment line above it as the description. The Make version had a 30-line `@echo` block in the `help:` target that had to be kept in sync by hand.
3. **No escape pain.** Shebang recipes (`#!/usr/bin/env bash`) let multi-step recipes (`deploy`, `rotate-secret`, `build-backup`) be plain bash scripts inside the recipe body — no `&&` chains, no `\` line continuations, no `$$` doubling for shell vars.

Install: `brew install just` (macOS) or `cargo install just` (Linux). Single Rust binary, no daemon, ~10ms cold start.

---

## File structure

```
.env.example                         dev template — copy to .env.local (Next.js dev)
products/menu/infra/.env.example                  infra template — copy to products/menu/infra/.env (Tofu + Kamal; NOT loaded by Next)
products/menu/infra/kamal/config/deploy.yml                    Kamal config — app + 3 accessories (postgres, cloudflared, backups)
products/menu/infra/kamal/.kamal/secrets           shell-evaluated references; committed, no values
products/menu/infra/tofu/                    menu.iedora.com — Cloudflare tunnel + DNS + R2 (encrypted state)
products/house/infra/tofu/              iedora.com root — narrow workers_deploy token (worker itself + DNS + cert created by `wrangler deploy`) (encrypted state)
justfile + products/menu/infra/justfile            entry point (root forwards into infra/, where recipes live)
products/menu/infra/Dockerfile                     multi-stage build for the Next app (Bun install, Node build, standalone)
scripts/migrate.mjs                  Drizzle migrator with pg_advisory_lock
```

---

## Troubleshooting

**`just menu::deploy` errors with `key not found` early on** — `products/menu/infra/.env` is missing or a required key isn't filled. Copy `products/menu/infra/.env.example` and fill in every value.

**`ssh root@host` asks for a password** — root SSH isn't accepting your key. Three causes: (a) key isn't in `/root/.ssh/authorized_keys` (re-run step 4b); (b) `/root/.ssh` perms are wrong (must be `700`, file `600`, both owned by `root`); (c) sshd disables root login (re-run step 4c to set `PermitRootLogin prohibit-password`).

**`kamal server bootstrap` hangs or fails** — root SSH isn't working. Re-check step 4: `ssh root@$ONPREM_HOST 'whoami'` must print `root` instantly. If it doesn't, your key isn't in `/root/.ssh/authorized_keys` or sshd is set to `PermitRootLogin no`.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages` in the scopes line. Re-run step 2.

**`cloudflared` reports 1033 or restart-loops after `just menu::destroy && just menu::deploy`** — `kamal accessory boot` (called inside `kamal setup`) is idempotent but skips containers that already exist, even Exited ones. The cloudflared container with the dead tunnel token sits there. Fix: `kamal accessory reboot cloudflared` (force-recreate). One-shot, not a recurring problem.

**Second product's hostname returns 530 / origin unreachable after `just <product>::deploy`** — happens when the 2nd product deploys onto a host where `kamal-proxy` already exists (created by the 1st product's deploy). The per-product `deploy` recipe probes for `kamal-proxy` and picks `kamal deploy` (not `kamal setup`) when it exists — but `kamal deploy` doesn't run `accessory boot all`, so the 2nd product's `cloudflared` never gets created. Symptom: app container is healthy (`docker ps` shows `<product>-web` Up), but no `<product>-cloudflared`, and the Cloudflare tunnel for that hostname has no active connections. Fixed permanently as of commit `8af016d` by adding an unconditional `kamal accessory boot all` to each product's deploy recipe BEFORE the setup/deploy split. If you see this on an older branch, manual workaround is `cd products/<product>/infra/kamal && bin/with-secrets bash -c 'exec kamal accessory boot cloudflared'`.

**502 from the tunnel** — `docker network inspect kamal` on the box should list 5 containers (kamal-proxy + 4 accessories + the app). If one's missing: `kamal accessory boot <name>` for that accessory, or check `kamal logs` for the app.

**Healthcheck flaps on first deploy** — app starts slower than `interval`. Raise `proxy.healthcheck.interval` in `products/menu/infra/kamal/config/deploy.yml`.

**`unable to find image` on the server** — registry push failed. `gh auth status` must show `write:packages`; if the smoketest `echo $(gh auth token) | docker login ghcr.io -u <user> --password-stdin` fails, the token is wrong.

**Build-time warnings about `BETTER_AUTH_SECRET`** — Better Auth reads `process.env` during `next build`. `products/menu/infra/Dockerfile` sets placeholder values for build-only; runtime values from Kamal's `--env-file` override them. If the warnings come back after a Dockerfile change, the placeholders got removed — re-add the `ENV BETTER_AUTH_SECRET=…` / `ENV BETTER_AUTH_URL=…` lines before `RUN node --run build`.

**`tofu destroy` prints `Warning: Resource Destruction Considerations` for `cloudflare_zero_trust_tunnel_cloudflared_config` and `cloudflare_r2_bucket_cors`** — harmless, expected, no action needed. The Cloudflare provider can't delete these two resource types via API because Cloudflare doesn't expose a separate delete endpoint for them — they're subresources of their parents:

- `cloudflare_zero_trust_tunnel_cloudflared_config` — the tunnel's ingress rules. Lives inside the tunnel; deleted automatically when the parent `cloudflare_zero_trust_tunnel_cloudflared.menu` is destroyed (which **does** work).
- `cloudflare_r2_bucket_cors` — the bucket's CORS policy. Lives inside the R2 bucket; deleted automatically when the parent `cloudflare_r2_bucket.assets` is destroyed.

Tofu only removes them from local state — that's all the warning is saying. Verified after a real `tofu destroy`: tunnel and buckets are gone from the Cloudflare dashboard along with their orphaned configs. On the next `tofu apply` the parents get recreated and Tofu provisions the configs anew. If you ever DO end up with a real orphan (e.g. you delete the tunnel out-of-band but the config sticks), `tofu apply` will reconcile by creating a new tunnel with new config and the old config disappears with its dead parent.
