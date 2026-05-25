# Stage 2 — `infra/`

Infrastructure-as-code only. One Tofu root provisions the Hetzner VPS, every Cloudflare resource, the GitHub Actions config, and every **shared** Docker container on the box. Stage-3 configurators (Zitadel app config, DB migrations, OpenObserve dashboards) and Stage-4 product deploys live elsewhere — see [`app-state/`](../app-state/) and [`deploy/iedora/runtime_*.go`](../deploy/iedora/).

## What this owns

**Tofu state ([`infra/tofu/`](tofu/)):**

- **Hetzner VPS** (`hetzner.tf`) — `hcloud_server.iedora` (CX23, Falkenstein, x86_64) + SSH key + firewall.
- **Cloudflare resources** (`main.tf`) — R2 buckets, scoped tokens, DNS records for `menu.iedora.com` / `auth.iedora.com` / `obs.iedora.com` / `assets.iedora.com` (all grey-cloud A records pointing directly at the VPS IPv4; Caddy terminates TLS on-box).
- **GitHub Actions config** (`github.tf`) — `github_actions_secret.secrets[*]` + `github_actions_variable.vars[*]`, `for_each` over a locals map; values flow from BWS via `TF_VAR_*` aliases.

**Tofu-managed SHARED containers** (`containers.tf`) — every always-on Docker container on the VPS via `kreuzwerker/docker` over SSH:

- `infra-postgres` — Postgres 18, shared by menu + zitadel databases. Boots from [`postgres/init.sql`](postgres/init.sql) (CREATE DATABASE menu / zitadel) which is `path.module/../postgres/init.sql` away.
- `infra-backups` — daily `pg_dumpall` → R2, GPG-encrypted. Image built from [`backup/`](backup/).
- `infra-openobserve` — OTLP receiver + UI on `127.0.0.1:5080`, R2 cold tier.
- `infra-zitadel` + `infra-zitadel-login` — the IdP runtime (Stage 3 reconciles its app-level state).
- `infra-caddy` — TLS termination + reverse proxy, bound to the VPS public IPv4.

The menu app (`infra-menu-web`) is **not** here — it's owned by Stage 4 (`task deploy:menu`) via the `dockerOnHetzner` productRuntime. Caddy routes to it by network alias; the container can come and go between deploys without touching Tofu.

## Hard rules

1. **Declarative-first.** Every resource here is Tofu-managed. **Edit `.tf` files, never the upstream UI** — `task up` will silently clobber UI edits.
2. **Tofu-managed credentials write through to BWS** as `IAC_*` (`secrets.tf::terraform_data.bws_sync_autogen` → `bin/bws-upsert`). Editing BWS directly is wasted work; the next apply restores Tofu's value.
3. **Bootstrap order is BWS → Tofu → write-through.** Operator pastes the `IAC_BOOTSTRAP_*` keys first; everything else is Tofu-minted.
4. **Follow [`docs/terraform-style.md`](../docs/terraform-style.md)** when editing any `.tf` — pessimistic `~>` pins, `for_each` over `count`, `validation` blocks.
5. **State file is encrypted in git.** PBKDF2 + AES-GCM, passphrase from `IAC_BOOTSTRAP_STATE_PASSPHRASE`. Rotation via the `fallback` block migration — see [`docs/deploy.md`](../docs/deploy.md) § Secret rotation.
6. **Run the pre-merge runbook on every deploy-shape change** — see [`docs/deploy.md`](../docs/deploy.md) § Pre-merge runbook.

## Stage 2 file layout

```
infra/
  tofu/                  Single Tofu root: Hetzner + Cloudflare + GitHub
                         config + shared service containers
                         (postgres, openobserve, zitadel, zitadel-login,
                         caddy, backups). Per-product containers (menu)
                         are NOT here — they're owned by Stage 4.
  cmd/iedora/            Stage 2/3/4 orchestrator (live).
                         Subcommands: iac, app, deploy, destroy,
                         pipeline, doctor.
  cmd/dev/               Local dev orchestrator (`task local`).
                         Mirrors the prod pipeline shape against
                         a local Docker daemon.
  cmd/zitadel-apply/     Stage 3 — reconciles Zitadel app state
                         (org, project, OIDC app, machine user + PAT,
                         action targets, admin grants).
  cmd/menu-db-migrations/ Stage 3 — drizzle-kit migrate against menu's
                         postgres database.
  cmd/openobserve-dashboards/ Stage 3 — pushes embedded JSON dashboards
                         via SSH `-L` tunnel.
  cmd/with-secrets/      BWS env wrapper. Stage-filtered (iac / app /
                         deploy + per-product).
  cmd/bws-upsert/        Idempotent BWS list-then-edit-or-create helper.
                         Used by Tofu's `terraform_data.bws_sync_*`.
  modules/services/      Tofu modules — one per shared container type.
  internal/              Go helpers: bws, cloudflare, r2, tlsprobe.
  bin/                   `go run` wrappers the Taskfile shells through.
  backup/                Self-built `iedora-backup` image (Dockerfile +
                         backup.sh / restore.sh / run.sh).
  postgres/              `init.sql` — bootstrap databases on first boot.
```

## See also

The [root Taskfile](../Taskfile.yml) is the only entry point operators
should need:

```
task doctor           # preflight: BWS auth, bootstrap secrets, PATH
task infra:up         # Stage 2: tofu apply on infra/tofu/
task app:apply        # Stage 3: every configurator
task deploy:menu      # Stage 4: docker pull + run on the box
task deploy:house     # Stage 4: bun build + per-product tofu apply
task up               # Full pipeline: 2 → 3 → 4
task down             # Full teardown: products → infra:down
task local              # Local dev stack
```

For day-2 raw-SSH ops (logs, psql, backup, restore, rotation, Zitadel
rebootstrap), see [`docs/deploy.md` § Day-2 operations](../docs/deploy.md#day-2-operations).
