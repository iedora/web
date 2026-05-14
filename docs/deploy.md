# Deploy — on-prem

> One-line purpose: build the Docker image, push to GHCR, and roll the new container with zero downtime onto an on-prem Ubuntu box reached via a Cloudflare Tunnel.
> **Last updated:** 2026.

Single deploy target: an on-prem Linux box. Cloudflare provides public ingress (Tunnel + DNS, TLS terminated at the edge), MinIO runs as a Kamal accessory for S3-compatible storage. Three tools work together:

| Tool | Responsibility |
|---|---|
| **OpenTofu** | Cloudflare Tunnel + ingress + DNS records (`infra/tofu/onprem/`) |
| **Ansible** | Server prep: deploy user, Docker, UFW, cloudflared (`infra/ansible/setup.yml`) |
| **Kamal** | App + accessories: Postgres + Redis + MinIO + the Next.js container |

```
Internet → Cloudflare edge (TLS) ─┬─→ cloudflared (outbound) → localhost:80   → kamal-proxy → app:3000
                                  └─→ cloudflared (outbound) → localhost:9000 → MinIO

DNS:  menu.example.com   → tunnel UUID → http://localhost:80
      assets.example.com → tunnel UUID → http://localhost:9000
```

**LAN access is deliberately not supported.** Hitting `http://$ONPREM_HOST` directly would mean HTTP cookies which Better Auth rejects when `BETTER_AUTH_URL=https://…` (browsers refuse `Secure` cookies over HTTP). On the LAN, use the public tunnel URL — Cloudflare resolves close to you and tunnels back, ~30-80ms overhead. For real local dev, `bun run dev`.

## Prerequisites

| Platform | Install Kamal |
|---|---|
| Linux / WSL | `sudo apt install -y ruby-full && sudo gem install kamal` |
| macOS | `brew install kamal` |

Also: `gh` CLI logged in (for `KAMAL_REGISTRY_PASSWORD=$(gh auth token)`), Docker running locally for the build, and an Ubuntu 24.04+ box reachable over SSH.

## One-time environment file

`.envrc` at the repo root holds everything the Make targets and Kamal need. It's gitignored. Fill it once, then `source .envrc` (or use `direnv`) in any shell.

```bash
# .envrc
export TF_VAR_state_passphrase='...'           # ≥ 16 chars, encrypts Tofu state
export TF_VAR_cloudflare_api_token='...'       # see "Cloudflare API token" below
export TF_VAR_account_id='...'                 # 32-char hex
export TF_VAR_zone_id='...'                    # 32-char hex

# Server identity — used by Ansible inventory + Kamal config.
# Use the box's mDNS hostname (set up by `make host-setup`); on the very
# first bootstrap before mDNS is up, fall back to the LAN IP.
export ONPREM_HOST='pwuserver.local'           # or 192.168.x.y for first bootstrap
```

The `make onprem-up` step below appends the Cloudflare outputs (PUBLIC_HOSTNAME, S3_ENDPOINT, CLOUDFLARED_TUNNEL_TOKEN, etc.) — those refresh on every apply; your TF_VAR_* values are preserved across syncs.

### About `ONPREM_HOST`

The `setup.yml` Ansible play enables mDNS on the box (`MulticastDNS=yes` in `systemd-resolved`) and opens UFW 5353/udp. After the first `make host-setup` run, the box advertises itself as `<hostname>.local` on the LAN — find the hostname with `hostname` on the box (or read it off any SSH prompt). Switch `.envrc` from the IP to that name and you never need to touch an IP again.

**Works from outside the LAN?** mDNS is LAN-only. For "deploy from a coffee shop", add **Tailscale** to the box + your laptop — `ONPREM_HOST=meta-menu.<tailnet>.ts.net` works from anywhere with no port-forward. Not implemented here; add as a follow-up if needed.

### Cloudflare API token

`dash.cloudflare.com → My Profile → API Tokens → Create Custom Token`. Permissions:

- Account · Cloudflare Tunnel · **Edit**
- Zone · DNS · **Edit** (scoped to your zone)
- Account · Account Settings · **Read**

That's it. No R2, no API-token-management — minimal surface area.

## Secrets

```bash
cp .kamal/secrets.example .kamal/secrets-common
$EDITOR .kamal/secrets-common
```

Fill in:
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
- `POSTGRES_PASSWORD` — `openssl rand -hex 32` (URL-safe)
- `DATABASE_URL` — substitute the password above into `postgres://postgres:<pwd>@meta-menu-postgres:5432/metamenu`
- `MINIO_ROOT_USER` — any alnum string ≥ 3 chars (e.g. `metamenu`)
- `MINIO_ROOT_PASSWORD` — `openssl rand -hex 32` (≥ 8 chars required by MinIO)

`S3_ACCESS_KEY=$MINIO_ROOT_USER` and `S3_SECRET_KEY=$MINIO_ROOT_PASSWORD` in the template wire the SDK creds to the MinIO root automatically.

## End-to-end deploy

```bash
source .envrc

# 1. Cloudflare side (Tunnel + DNS + 2 ingresses).
make onprem-up NAME=default HOSTNAME=menu.example.com
source .envrc                                # pick up the new outputs

# 2. Server side (first time only — needs the password of an existing sudo user).
sudo apt install -y sshpass                  # if not already installed
make host-bootstrap BOOTSTRAP_USER=pwu       # creates `deploy` user + installs SSH key
make host-setup                              # Docker + UFW + cloudflared

# 3. First Kamal deploy.
make kamal-bootstrap                         # boots accessories + 1st migration
make kamal-deploy                            # rolls the app
```

Visit `https://menu.example.com` — app live. Uploads go to `https://assets.example.com/metamenu/<key>` via the second tunnel ingress.

## Day-2 deploys

```bash
make kamal-deploy           # build + push + migrate (pre-deploy hook) + roll
```

Sequence:

1. **Build + push** new image to GHCR (registry cache warmed).
2. **`.kamal/hooks/pre-deploy`** runs — `kamal app exec --primary --version=$KAMAL_VERSION "node scripts/migrate.mjs"`. Acquires `pg_advisory_lock`, applies pending Drizzle migrations. Failure aborts the deploy; old container keeps serving with old schema.
3. **Rolling deploy** — new container boots, waits for `GET /up` to return 200, then traffic flips.

On rollback the hook skips migrations — old image runs against old schema.

> **Migration limitation** — only **additive** changes are zero-downtime (add nullable column, add table, `CREATE INDEX CONCURRENTLY`). Renames/drops need expand-contract across multiple deploys.

### Escape hatch — manual migration

```bash
make migrate    # kamal app exec --reuse "node scripts/migrate.mjs"
```

Runs migrations against the currently-serving image. Useful for hot-fixes or re-running after a pipeline failure.

## Day-2 ops

```bash
make kamal-logs              # tail logs (-f)
make kamal-app               # shell inside the running app container
make kamal-rollback          # rollback to previous version
make kamal-redeploy          # re-pull current image without rebuild
```

For commands outside the Makefile:
```bash
kamal app details
kamal accessory boot minio
kamal config                 # prints fully-resolved config (debug)
```

## Multi-environment

If you ever need a second env (staging, customer-X, …) on a different box:

```bash
make onprem-up NAME=staging HOSTNAME=staging.menu.example.com
source .envrc.staging        # not .envrc — staging gets its own file
# Edit config/deploy.yml's `servers.web.hosts` to point at the new box
# (or split it back into deploy.yml + deploy.<dest>.yml destinations)
```

Tofu workspaces handle the Cloudflare side per-env automatically. Kamal-side destinations were collapsed (single target = no destinations file needed); restore them if multi-env Kamal becomes necessary.

## Structure

```
Dockerfile                    multi-stage build (Bun install, Node build, standalone runtime)
.dockerignore                 keeps node_modules, .next, infra/, tests/ out of the image
config/
  deploy.yml                  Kamal config (single target — on-prem)
.kamal/
  hooks/pre-deploy            runs Drizzle migrations against KAMAL_VERSION before traffic flip
  secrets-common              real values (gitignored)
  secrets.example             committed template
infra/
  tofu/onprem/                Cloudflare Tunnel + ingress + DNS (per-env Tofu workspace)
    envs/example.tfvars       template for envs/<name>.tfvars
  ansible/
    inventory.yml             static inventory (your boxes, manually maintained)
    bootstrap.yml             one-shot: create deploy user + install SSH key
    setup.yml                 base / metal / onprem plays (apt + Docker + UFW + cloudflared)
scripts/
  bootstrap.sh                first Kamal deploy (pre-boot accessories + setup --skip-hooks + 1st migration)
  onprem-env.sh               multi-env wrapper for the Tofu module (workspaces)
  onprem-sync.sh              reads Tofu outputs, refreshes .envrc[.<name>]
  migrate.mjs                 Drizzle migrations under pg_advisory_lock (parallel-safe)
```

## Troubleshooting

**`kamal setup` fails with "Cannot connect to Docker"**: the deploy user isn't in the `docker` group. Re-run `make host-setup`.

**Healthcheck flaps in loop**: app starts slower than `interval`. Raise `proxy.healthcheck.interval` in `config/deploy.yml`.

**"unable to find image" on the server**: registry push failed. Check `gh auth status` resolves a valid token.

**App returns 500 with missing env**: `kamal app exec --reuse env | grep -E 'BETTER|DATABASE|REDIS|S3'`. ERB in `deploy.yml` reads your shell env, not `.kamal/secrets-common` — `source .envrc` before `make kamal-deploy`.

**Cloudflare Tunnel shows "degraded"**: outbound to `*.cloudflare.com` is blocked. UFW outgoing policy is allow by default; check the network.

**`cloudflared.service` stuck in `activating (auto-restart)`**: token wrong, or `/etc/cloudflared/token` unreadable. `journalctl -u cloudflared -n 50` — re-run `make host-setup` with `CLOUDFLARED_TUNNEL_TOKEN` set.

**"missing required env var PUBLIC_HOSTNAME"**: you didn't `source .envrc` after `make onprem-up`.
