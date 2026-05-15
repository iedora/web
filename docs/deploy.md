# Deploy — homelab box or cloud VPS behind a Cloudflare Tunnel

End-to-end self-host: edit one config file, run one command, app live behind a Cloudflare Tunnel with TLS. Kamal 2 does the heavy lifting; the only "script" is the Makefile.

```
Internet → Cloudflare edge (TLS) ─→ cloudflared accessory (outbound)
                                       │   (kamal Docker network)
                                       ├─→ http://kamal-proxy          → app:3000
                                       └─→ http://meta-menu-minio:9000 → MinIO
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

Kamal pushes the built image to `ghcr.io/<your-github-username>/meta-menu`. The scope is per-token, not per-package — do it once, ever. Confirm with `gh auth status` and look for `write:packages` in the scopes line.

---

## Step 3 — One-time Cloudflare prep

You need an existing zone (a domain you control, like `example.com`, added to your Cloudflare account). Then create a scoped API token:

1. `dash.cloudflare.com` → top-right profile → **API Tokens** → **Create Custom Token**
2. Add permissions:
   - **Account · Cloudflare Tunnel · Edit**
   - **Zone · DNS · Edit** (scope to the specific zone)
   - **Account · Account Settings · Read**
3. Copy the token — you'll paste it into `infra/.env`.

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

## Step 5 — Clone, configure, generate secrets

```bash
git clone https://github.com/<you>/meta-menu.git
cd meta-menu
cp infra/.env.example infra/.env
```

`infra/.env` has 7 inputs you fill in and 4 secrets you generate. Use `openssl rand -hex 32` four times and paste into `STATE_PASSPHRASE` / `BETTER_AUTH_SECRET` / `POSTGRES_PASSWORD` / `MINIO_ROOT_PASSWORD`:

```bash
# Cloudflare (from step 3)
CLOUDFLARE_ACCOUNT_ID=2716bf6ee8be2880904e70f19050d2ef
CLOUDFLARE_ZONE_ID=133ea809e27a8770c6ea83a257ba2ff5
CLOUDFLARE_API_TOKEN=cf-token-from-step-3

# The hostname your app lives at (must be a subdomain of your Cloudflare zone)
PUBLIC_HOSTNAME=menu.example.com

# The box (cloud VPS public IP or homelab LAN IP). Kamal connects as root.
ONPREM_HOST=192.168.50.53

# Your GitHub username — image will be pushed to ghcr.io/<this>/meta-menu
GHCR_USER=eduvhc

# Generated secrets (openssl rand -hex 32 each)
STATE_PASSPHRASE=…
BETTER_AUTH_SECRET=…
POSTGRES_PASSWORD=…
MINIO_ROOT_PASSWORD=…

MINIO_ROOT_USER=metamenu
```

Keep `infra/.env` in your password manager — it holds everything needed to redeploy from scratch. The file is gitignored.

---

## Step 6 — Deploy

```bash
make deploy
```

Same command for first-time AND every-other-time. Internally it runs:

1. **`tofu apply`** — creates (or updates) the Cloudflare Tunnel + 2 ingress rules + 2 DNS CNAMEs.
2. **`kamal setup`** — Kamal's idempotent first-time-or-anytime command:
   - `kamal server bootstrap` — installs Docker on the box if not already (no-op on subsequent runs).
   - `kamal accessory boot all` — boots postgres, redis, minio, cloudflared (no-op if already running).
   - `kamal deploy` — builds the image natively on the box (amd64, no QEMU on the Mac via `builder.remote`), pushes to GHCR, pulls on the box, starts the app container.

The app container's start command is `node scripts/migrate.mjs && node server.js` — Drizzle migrations run under a `pg_advisory_lock` (safe across multiple replicas) before the server boots.

Total time: **5–10 min** the first time (cold image build). Subsequent deploys are 1–2 min with the build cache (the no-op setup checks add ~10s — acceptable for not having two commands to remember).

When it finishes, hit `https://$PUBLIC_HOSTNAME/up` — should return `{"ok":true,"db":"ok"}`.

---

## Day-2 commands

```bash
make logs           # tail app logs (rolling)
make console        # bash inside a fresh app container with env loaded
make migrate        # run migrations on the current image (rare; container start already does this)
make redeploy       # re-pull current image, no rebuild
make rollback       # roll back to the previous version
make destroy        # tofu destroy — removes the Cloudflare tunnel + DNS only; box untouched
```

All are direct `kamal` calls — the Makefile only loads `infra/.env`, exports its values, and resolves the gem-bin PATH so subprocesses find `kamal`.

For ad-hoc kamal commands (e.g. `kamal app stop`, `kamal accessory exec`), source `infra/.env` first:

```bash
set -a; . infra/.env; set +a
kamal app stop
```

---

## Adding a second box / a cloud VPS later

Same five steps — only step 4 (provisioning) differs. For a cloud VPS, **nothing** is needed in step 4 because the image ships with root SSH already. For a second box, you'd typically use Kamal's multi-host config — bump `servers.web.hosts` in `infra/kamal/config/deploy.yml` to a list, and Kamal load-balances behind kamal-proxy.

---

## How values flow

- **`infra/.env`** → Makefile `-include` + `export` → visible to every `tofu`/`kamal` subprocess.
- **Tunnel token** → generated by `tofu apply`, read at deploy time by `infra/kamal/.kamal/secrets` via `$(tofu -chdir=../tofu output -raw tunnel_token)` (paths are relative to Kamal's cwd, `infra/kamal/`). No manual copy step.
- **Registry password** → `$(gh auth token)` evaluated when Kamal logs into ghcr.io.
- **App secrets** (BETTER_AUTH_SECRET, POSTGRES_PASSWORD, etc.) → `.kamal/secrets` references `$VAR` form, which Kamal evaluates against the env (sourced from `infra/.env` via the Makefile).

`.kamal/secrets` is checked into git — it contains **only references**, never values.

---

## Updating the Cloudflare tunnel (adding routes, etc.)

`infra/tofu/main.tf` defines ingress + DNS. Edit it (e.g. add a third ingress rule for a new accessory), then `make deploy` — `tofu apply` runs first and pushes the change. DNS + ingress propagate in seconds.

---

## File structure

```
.env.example                         dev template — copy to .env.local (Next.js dev)
infra/.env.example                  infra template — copy to infra/.env (Tofu + Kamal; NOT loaded by Next)
infra/kamal/config/deploy.yml                    Kamal config — app + 4 accessories (postgres, redis, minio, cloudflared)
infra/kamal/.kamal/secrets           shell-evaluated references; committed, no values
infra/tofu/                          Cloudflare tunnel + DNS + ingress (encrypted state)
Makefile                             the only entry point (calls tofu + kamal directly)
infra/Dockerfile                     multi-stage build for the Next app (Bun install, Node build, standalone)
scripts/migrate.mjs                  Drizzle migrator with pg_advisory_lock
```

---

## Troubleshooting

**`make deploy` errors with `key not found` early on** — `infra/.env` is missing or a required key isn't filled. Copy `infra/.env.example` and fill in every value.

**`ssh root@host` asks for a password** — root SSH isn't accepting your key. Three causes: (a) key isn't in `/root/.ssh/authorized_keys` (re-run step 4b); (b) `/root/.ssh` perms are wrong (must be `700`, file `600`, both owned by `root`); (c) sshd disables root login (re-run step 4c to set `PermitRootLogin prohibit-password`).

**`kamal server bootstrap` hangs or fails** — root SSH isn't working. Re-check step 4: `ssh root@$ONPREM_HOST 'whoami'` must print `root` instantly. If it doesn't, your key isn't in `/root/.ssh/authorized_keys` or sshd is set to `PermitRootLogin no`.

**GHCR push returns "denied"** — `gh auth status` must show `write:packages` in the scopes line. Re-run step 2.

**`cloudflared` reports 1033 or restart-loops after `make destroy && make deploy`** — `kamal accessory boot` (called inside `kamal setup`) is idempotent but skips containers that already exist, even Exited ones. The cloudflared container with the dead tunnel token sits there. Fix: `kamal accessory reboot cloudflared` (force-recreate). One-shot, not a recurring problem.

**502 from the tunnel** — `docker network inspect kamal` on the box should list 5 containers (kamal-proxy + 4 accessories + the app). If one's missing: `kamal accessory boot <name>` for that accessory, or check `kamal logs` for the app.

**Healthcheck flaps on first deploy** — app starts slower than `interval`. Raise `proxy.healthcheck.interval` in `infra/kamal/config/deploy.yml`.

**`unable to find image` on the server** — registry push failed. `gh auth status` must show `write:packages`; if the smoketest `echo $(gh auth token) | docker login ghcr.io -u <user> --password-stdin` fails, the token is wrong.

**Build-time warnings about `BETTER_AUTH_SECRET`** — Better Auth reads `process.env` during `next build`. `infra/Dockerfile` sets placeholder values for build-only; runtime values from Kamal's `--env-file` override them. If the warnings come back after a Dockerfile change, the placeholders got removed — re-add the `ENV BETTER_AUTH_SECRET=…` / `ENV BETTER_AUTH_URL=…` lines before `RUN node --run build`.
