# Infra — provisioning servers

> One-line purpose: get a Linux box (yours, on-prem) into a state where `make kamal-deploy` works against it.
> **Last updated:** 2026.

> **TL;DR** — single deploy target: an on-prem Ubuntu 24.04+ box behind a Cloudflare Tunnel. OpenTofu manages Cloudflare resources (Tunnel + DNS), Ansible preps the box (Docker + UFW + cloudflared), Kamal handles the app + accessories (Postgres + Redis + MinIO).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cloudflare side (OpenTofu)                                          │
│   Tunnel + 2 ingress rules (app + assets) + 2 DNS CNAMEs             │
│   Per-env Tofu workspace = independent tunnel/DNS per environment    │
├──────────────────────────────────────────────────────────────────────┤
│  Server side (Ansible)                                               │
│   1 playbook (setup.yml) — base / metal / onprem plays               │
│   FQCN-only, deb822 apt repos, hardened cloudflared systemd unit     │
├──────────────────────────────────────────────────────────────────────┤
│  App side (Kamal) — see deploy.md                                    │
│   Zero-downtime rolling deploy + pre-deploy migrations + MinIO       │
└──────────────────────────────────────────────────────────────────────┘
```

## Layout

```
infra/
  shared/vars.yml             shared by Ansible (deploy_user, vm_name, timezone, …)
  tofu/onprem/                Tofu env — Cloudflare Tunnel + ingress + DNS
    main.tf                   tunnel + _config (2 ingresses) + _token + 2 dns_records
    variables.tf              account_id, zone_id, public_hostname, assets_hostname
    versions.tf               cloudflare ~> 5.19 + state encryption
    outputs.tf                public_hostname, assets_hostname, tunnel_id, tunnel_token (sensitive)
    envs/example.tfvars       template — copy to envs/<name>.tfvars per env
  ansible/
    inventory.yml             static inventory (your boxes; manually maintained)
    bootstrap.yml             one-shot: create deploy user + install SSH key
    setup.yml                 main playbook — base / metal / onprem plays
    requirements.yml          community.general, ansible.posix
scripts/
  bootstrap.sh                first Kamal bootstrap (pre-boot accessories + setup --skip-hooks)
  onprem-env.sh               multi-env wrapper for the Tofu module (workspaces)
  onprem-sync.sh              reads Tofu outputs, refreshes .envrc / .envrc.<name>
  migrate.mjs                 Drizzle migrations under pg_advisory_lock (parallel-safe)
```

## Cloudflare side (Tunnel + DNS — one Tofu workspace per env)

`infra/tofu/onprem/` manages the Cloudflare-side resources: the Zero Trust Tunnel + 2 ingress rules (app + assets) + 2 proxied DNS CNAMEs. Storage stays on-prem (MinIO Kamal accessory) so R2 is out of scope.

Multi-env via Tofu workspaces: one workspace = one env (`default`, `prod`, `staging`, …), each with its own state file and `envs/<name>.tfvars`.

Prereqs (one-time per machine):
- Cloudflare account + a zone you control.
- API token with: Account · Cloudflare Tunnel · Edit, Zone · DNS · Edit (scoped to the zone), Account · Account Settings · Read.
- `account_id` and `zone_id` (both 32-char hex).

All four go into `.envrc` at the repo root (gitignored), plus `TF_VAR_state_passphrase` for the Tofu state encryption. `source .envrc` once per shell.

### Spin up an env

```bash
make onprem-up NAME=default HOSTNAME=menu.example.com
```

Behind the scenes (`scripts/onprem-env.sh new`):
1. Scaffolds `infra/tofu/onprem/envs/default.tfvars` from the inputs.
2. Creates/selects the Tofu workspace.
3. Runs `tofu apply` — tunnel + 2 ingresses + 2 DNS records.
4. Invokes `scripts/onprem-sync.sh` which appends Tofu outputs to `.envrc[.<name>]` (PUBLIC_HOSTNAME, ASSETS_HOSTNAME, S3_*, CLOUDFLARED_TUNNEL_TOKEN). TF_VAR_* lines you put there manually are preserved.

```bash
source .envrc        # for NAME=default; else .envrc.<name>
```

`assets_hostname` defaults to `assets.<rest-of-public-hostname>` (so `menu.example.com` → `assets.example.com`). Override via the `assets_hostname` variable.

### Day-2 ops

```bash
make onprem-apply NAME=<env>     # re-apply
make onprem-list                 # list Tofu workspaces
make onprem-destroy NAME=<env>   # tofu destroy + remove workspace + .envrc.<env>
```

## Server side (Ansible)

Prereqs:
- Ansible installed locally (`apt install ansible` / `brew install ansible`)
- `sshpass` for the bootstrap step (`apt install sshpass`)
- An SSH key at `~/.ssh/id_ed25519` (`make ssh-key` generates if absent)

Prereqs on the target box:
- Ubuntu 24.04 LTS or later
- An existing sudo user with SSH password auth (e.g. `pwu`, `ubuntu`)
- sshd running on port 22

### First time on a fresh box

```bash
make host-bootstrap BOOTSTRAP_USER=pwu
# prompts twice: SSH password + sudo password
```

Creates `deploy` user, installs your SSH key, grants NOPASSWD sudo. Idempotent.

### Full setup

```bash
source .envrc                   # carries CLOUDFLARED_TUNNEL_TOKEN
make host-setup
```

Installs Docker + apt-pinned deb822 repos, configures UFW, registers `cloudflared.service` as a hardened systemd unit reading the tunnel token from `/etc/cloudflared/token` (0400 root:cloudflared). Re-running is safe — only changed tasks run.

If `CLOUDFLARED_TUNNEL_TOKEN` is empty, the cloudflared play is skipped (`meta: end_host`). You can provision the box first and add the tunnel later by re-running with the env var set.

### Adding another on-prem box

Edit `infra/ansible/inventory.yml`, copy a host block, change `ansible_host` (use a different env var lookup, e.g. `{{ lookup('env', 'ONPREM_HOST_STAGING') }}`). Re-run `host-bootstrap` then `host-setup` against the new host. Each host gets its own Cloudflare Tunnel (one Tofu workspace = one tunnel = one token).

### No IP, please — use mDNS

`setup.yml` enables `MulticastDNS=yes` in `systemd-resolved` and opens UFW 5353/udp. After the first setup, the box advertises as `<hostname>.local` on the LAN. Set `ONPREM_HOST=<hostname>.local` in `.envrc` and you never type an IP again. For off-LAN access, add Tailscale (`meta-menu.<tailnet>.ts.net` works anywhere).

## Design choices

- **OpenTofu 1.10+**. State + plan encryption enabled (`enforced = true`). Passphrase from `TF_VAR_state_passphrase`.
- **`terraform_data`** instead of `null_resource`.
- **FQCN everywhere in Ansible** (`ansible.builtin.apt`, `community.general.ufw`, …).
- **`deb822_repository`** instead of deprecated `apt_key` + `apt_repository`.
- **`cloudflared --token-file`** (≥ 2025.4.0). Token never appears in `ps`. Dedicated `cloudflared` user, hardened systemd unit.
- **State stays local**. For team workflows / CI, migrate to S3 backend (OpenTofu 1.10 has native S3 state locking).

## Troubleshooting

**`tofu init` complains about provider plugins**: provider versions changed. Delete `.terraform/` and re-init. Lock file regenerates.

**`cloudflared.service` stuck in `activating (auto-restart)`**: token wrong or `/etc/cloudflared/token` unreadable. `journalctl -u cloudflared -n 50` — re-run `host-setup` with a correct `CLOUDFLARED_TUNNEL_TOKEN`.

**Ansible fails with "Host key verification failed"**: inventory disables host-key checking already. If it still complains, `ssh-keygen -R <ip>`.

**`tofu apply` errors with "encryption configuration missing"**: export `TF_VAR_state_passphrase` (≥ 16 chars).
