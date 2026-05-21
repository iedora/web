# Every container on the Hetzner box — postgres, openobserve, zitadel, the
# backups job, the cloudflared sidecars, and the menu app itself. One
# `tofu apply` boots the lot.
#
# Network: `docker_network.iedora`. Container-DNS resolution
# (`infra-postgres`, `infra-openobserve`, `infra-zitadel`) is by alias and
# unaffected by the network name itself.

# ── Network ──────────────────────────────────────────────────────────────────

resource "docker_network" "iedora" {
  name   = "iedora"
  driver = "bridge"

  # Every other docker_* resource in this file references either this
  # network or the bootstrap volume, so chaining the docker readiness
  # barrier through these two foundational resources transitively gates
  # every container behind cloud-init finishing on the Hetzner box.
  #
  # No prevent_destroy lifecycle: every container attaching to this
  # network depends on it in the TF graph, so `tofu destroy` tears
  # them down first. The "Docker refuses because containers are
  # attached" failure mode the guard was defending against can't
  # happen through TF.
  depends_on = [null_resource.docker_ready]
}

# ── Shared volumes ───────────────────────────────────────────────────────────

resource "docker_volume" "zitadel_bootstrap" {
  name = "zitadel-bootstrap"

  # Holds the login-client PAT (login-client.pat) written by infra-zitadel
  # during FirstInstance and read by infra-zitadel-login on every login
  # flow. Lifecycle == as long as zitadel exists; destroying this volume
  # is the recovery path for "PAT lost" scenarios (see docs/infra/auth.md).

  depends_on = [null_resource.docker_ready]
}

resource "docker_volume" "caddy_data" {
  name = "caddy-data"

  # Caddy's auto-acquired Let's Encrypt certs + ACME account material.
  # Persists across container recreations so we don't trigger LE rate
  # limits on Caddyfile edits. Wiping this is the recovery path for cert
  # corruption.
  depends_on = [null_resource.docker_ready]
}

# Docker creates named volumes as `root:root 755`. Zitadel runs as the
# non-root `zitadel` user (UID 1000), zitadel-login as `nextjs` (UID 1001)
# — neither can write to the default mode. We use a one-shot init container
# (alpine, `chmod 777 /x; exit 0`) instead of an SSH-shelling `local-exec`
# provisioner: the init runs entirely through the docker provider, no
# host-shell roundtrip, no SSH agent on whichever machine ran `tofu apply`
# (matters for future CI deploys). `must_run = false` + `wait = true`
# make Tofu wait for the container to exit before declaring success.
# The volume is namespace-isolated to the two zitadel containers anyway,
# so 777 isn't a real surface area increase.
resource "docker_container" "zitadel_bootstrap_chmod" {
  name    = "infra-zitadel-bootstrap-chmod"
  image   = "busybox:1.37"
  command = ["chmod", "777", "/x"]

  # One-shot — runs the chmod and exits. `attach=true` blocks Tofu until
  # the container exits (so the chmod has actually happened by the time
  # docker_container.zitadel starts). `must_run=false` is required to
  # tell Tofu the Exited state is desired, not a failure.
  # We deliberately do NOT use `rm=true` — `attach`+`rm` races against
  # the provider re-inspecting the container post-exit. The Stopped
  # container lingers (a few KB); cheap. Re-applies are no-ops.
  must_run = false
  attach   = true

  volumes {
    container_path = "/x"
    volume_name    = docker_volume.zitadel_bootstrap.name
  }
}

# ── Postgres ─────────────────────────────────────────────────────────────────
# Bind-mounts `/root/infra-postgres/data` on the host so the data dir
# survives container recreation. Currently holds the menu and zitadel
# databases.

module "postgres" {
  source = "../modules/services/postgres"

  network_name      = docker_network.iedora.name
  postgres_password = random_password.postgres.result
  data_path         = "/root/infra-postgres/data"
  init_sql          = file("${path.module}/../postgres/init.sql")
  # Container-only — backups + zitadel reach it via the iedora network.
}

# ── OpenObserve (observability backend) ──────────────────────────────────────
# Cold tier on R2: parquet shards roll from local disk into the shared
# `iedora-data` bucket under the `o2/` prefix (backups sibling-prefix
# under `pg/`). One bucket, one token — `cloudflare_api_token.data_r2`
# writes both via S3_PREFIX separation.

module "openobserve" {
  source = "../modules/services/openobserve"

  network_name       = docker_network.iedora.name
  data_path          = "/root/infra-openobserve/openobserve-data"
  root_user_email    = var.infra_openobserve_root_user_email
  root_user_password = random_password.openobserve_password.result
  s3 = {
    endpoint      = "https://${var.account_id}.r2.cloudflarestorage.com"
    region        = "auto"
    bucket        = cloudflare_r2_bucket.data.name
    bucket_prefix = "o2"
    access_key    = cloudflare_api_token.data_r2.id
    secret_key    = sha256(cloudflare_api_token.data_r2.value)
  }
  # No host port — UI access is via ssh -L tunnel; products talk to
  # infra-openobserve:5080 on the iedora network.
}

# ── Backups (self-built image) ───────────────────────────────────────────────
# Pulls from GHCR which requires auth; the provider's registry_auth block
# below ties to `var.infra_ghcr_token`. The image runs an internal cron
# that calls backup.sh every @daily and pg_dumpalls every database on
# infra-postgres (menu + zitadel) → R2.

resource "docker_container" "backups" {
  name    = "infra-backups"
  image   = "ghcr.io/${var.github_owner}/iedora-backup:18"
  restart = "unless-stopped"

  env = [
    "SCHEDULE=@daily",
    "BACKUP_KEEP_DAYS=14",
    "S3_REGION=auto",
    "S3_ENDPOINT=https://${var.account_id}.r2.cloudflarestorage.com",
    # Backups land in the shared private `iedora-data` bucket under `pg/`.
    # Future internal datasets (e.g. parquet shards if OpenObserve ever
    # outgrows local mode) sibling-prefix under the same bucket.
    "S3_BUCKET=${cloudflare_r2_bucket.data.name}",
    "S3_PREFIX=pg",
    "POSTGRES_HOST=infra-postgres",
    # Empty → backup.sh uses --all-databases (every iedora product).
    "POSTGRES_DATABASE=",
    "POSTGRES_USER=postgres",
    "POSTGRES_PASSWORD=${random_password.postgres.result}",
    "S3_ACCESS_KEY_ID=${cloudflare_api_token.data_r2.id}",
    "S3_SECRET_ACCESS_KEY=${sha256(cloudflare_api_token.data_r2.value)}",
    "PASSPHRASE=${random_password.backup_passphrase.result}",
  ]

  networks_advanced {
    name = docker_network.iedora.name
  }

  log_opts = {
    max-size = "10m"
  }
}

# ── Zitadel IdP (#19) ────────────────────────────────────────────────────────
# `start-from-init` runs migrations + (on the FIRST boot only) the
# FirstInstance step that creates the org, the human admin, and the
# login-client machine user + PAT. The PAT is written to the shared
# `zitadel-bootstrap` named volume; the login app reads it on every flow.
#
# IMPORTANT: the FirstInstance step pulls from the SETUP viper, NOT the
# main config viper — so org/human/loginclient env vars use the
# `ZITADEL_FIRSTINSTANCE_*` prefix, not `ZITADEL_DEFAULTINSTANCE_*`.
# Earlier iterations of this config used DEFAULTINSTANCE_ and the
# FirstInstance step silently fell back to its steps.yaml defaults
# (Org=ZITADEL, password=Password1!) — discovered the hard way during
# Phase 1 stand-up.

module "zitadel" {
  source = "../modules/services/zitadel"

  network_name      = docker_network.iedora.name
  masterkey         = random_password.zitadel_masterkey.result
  external_domain   = var.zitadel_hostname
  external_port     = 443
  external_secure   = true
  login_v2_base_uri = "https://${var.zitadel_hostname}/ui/v2/login"
  postgres_host     = "infra-postgres"
  postgres_password = random_password.postgres.result
  admin_username    = "eduvhc"
  admin_email       = "eduardoferdcarvalho@gmail.com"
  admin_password    = random_password.zitadel_first_admin.result
  bootstrap_path    = docker_volume.zitadel_bootstrap.name

  # Prod's TF provider authenticates with the FirstInstance-minted
  # JSON machine key (Type=1 RSA, JSON Web Profile). The key file at
  # /zitadel-bootstrap/zitadel-admin-sa.json is pulled by
  # `just infra::zitadel-fetch-sa-key` → BWS → TF_VAR_infra_zitadel_sa_key_json.
  machine_username = "zitadel-admin-sa"
  machine_name     = "Terraform"
  machine_key_type = "json"

  depends_on = [
    module.postgres,
    docker_container.zitadel_bootstrap_chmod,
  ]
}

# Login UI v2 — Next.js companion to the main binary. Path /ui/v2/* on the
# tunnel routes here; everything else stays on the binary.

module "zitadel_login" {
  source = "../modules/services/zitadel-login"

  network_name = docker_network.iedora.name
  # The login UI MUST hit Zitadel with the same `Host:` header Zitadel
  # advertises as its ExternalDomain — otherwise the API returns
  # "Instance not found" (Zitadel matches the instance by Host). Going
  # straight to `http://infra-zitadel:8080` fails because the Host
  # would be `infra-zitadel:8080`.
  #
  # Fix: hit Zitadel through Caddy. host-gateway maps auth.iedora.com
  # inside the container to the VPS's host IP, where Caddy sits on :443
  # and reverse-proxies to infra-zitadel:8080 with the right Host
  # header. Same path external clients take.
  api_url        = "https://auth.iedora.com"
  bootstrap_path = docker_volume.zitadel_bootstrap.name
  host_entries = [
    { host = "auth.iedora.com", ip = "host-gateway" },
  ]

  depends_on = [module.zitadel]
}

# ── Caddy (TLS termination for auth.iedora.com) ──────────────────────────────
# The ONLY hostname that bypasses Cloudflare on this box. Direct A record
# (proxied=false in main.tf) → Hetzner IPv4 → here. Caddy auto-acquires Let's
# Encrypt certs (HTTP-01 on :80) and forwards:
#   - /ui/v2/*  → infra-zitadel-login:3000 (Next.js, HTTP/1.1)
#   - everything else → infra-zitadel:8080 with h2c (gRPC + REST mux)
#
# The h2c transport is REQUIRED for the Zitadel TF provider to work — that's
# the entire reason we're not using CF Tunnel for this hostname. Without
# h2c, gRPC requests stall (HTTP/2 trailers don't survive HTTP/1.1 hops).
#
# menu + obs keep their CF Tunnels for now (HTTP/1.1 traffic only, CF
# DDoS protection still valuable). If we ever want to drop CF for those too,
# add more route blocks to the Caddyfile + DNS records here.

# ── Menu app (Next.js SaaS) ─────────────────────────────────────────────────
# SHA-pinned image. CI writes `${{ github.sha }}` and dispatches infra-deploy
# with it as a workflow input; bin/with-secrets exports it as
# TF_VAR_menu_image_sha. When the SHA changes, the image resource's `name`
# changes → force-replace → docker_container.menu_web also replaces because
# it references `docker_image.menu.image_id`.
#
# Default "latest" for first-bootstrap (before CI has run); steady state is
# always a SHA. Rollback: set TF_VAR_menu_image_sha to an older commit
# (image is immutable per tag, deterministic).
#
# Migrations: `node scripts/migrate.mjs` holds a `pg_advisory_lock` so a
# rolling restart (multiple replicas one day) doesn't double-migrate. It's
# safe to re-run on a populated DB.
#
# Auth wiring (#20):
#   - ZITADEL_OAUTH_CLIENT_* and MENU_SESSION_SECRET flow straight from
#     other TF resources in this same root (zitadel_application_oidc.menu,
#     random_password.menu_session_secret). No BWS, no chicken-egg.
#   - Container gates on `local.zitadel_bootstrapped`: during the one-time
#     bootstrap window (before the SA key reaches BWS) the OIDC app
#     doesn't exist, so menu can't boot. Acceptable for the few-minute
#     bootstrap; menu is back up on the second `just infra::deploy`.

resource "docker_image" "menu" {
  name = "ghcr.io/${var.github_owner}/menu:${var.menu_image_sha}"

  # Keep the image cached on the host so a container restart doesn't re-pull.
  # New SHA = new name = force-replace = single pull on next apply.
  keep_locally = true

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }
}

module "menu_env" {
  source = "../modules/menu_env"

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }

  node_env        = "production"
  database_url    = "postgres://postgres:${random_password.postgres.result}@infra-postgres:5432/menu"
  menu_public_url = "https://${var.menu_public_hostname}"

  menu_session_secret         = random_password.menu_session_secret.result
  zitadel_issuer_url          = "https://${var.zitadel_hostname}"
  zitadel_oauth_client_id     = zitadel_application_oidc.menu.client_id
  zitadel_oauth_client_secret = zitadel_application_oidc.menu.client_secret
  zitadel_management_token    = zitadel_personal_access_token.menu_sa.token
  zitadel_action_signing_key  = zitadel_action_target.menu_permissions.signing_key
  iedora_project_id           = zitadel_project.iedora.id
  iedora_admin_emails         = join(",", var.iedora_admin_emails)

  # Shared assets bucket (cloudflare_r2_bucket.assets in main.tf).
  s3_endpoint   = "https://${var.account_id}.r2.cloudflarestorage.com"
  s3_region     = "auto"
  s3_access_key = cloudflare_api_token.assets_r2.id
  s3_secret_key = sha256(cloudflare_api_token.assets_r2.value)
  s3_bucket     = cloudflare_r2_bucket.assets.name
  s3_public_url = "https://${var.assets_hostname}"

  # OpenObserve runs in ZO_LOCAL_MODE — Basic auth header is the same
  # shape as the dev compose, fed from BWS-backed credentials.
  otel_exporter_otlp_endpoint = "http://infra-openobserve:5080/api/default"
  otel_exporter_otlp_headers  = "Authorization=Basic%20${base64encode("${var.infra_openobserve_root_user_email}:${random_password.openobserve_password.result}")}"

  host_name = hcloud_server.iedora.name
  git_sha   = var.menu_image_sha
}

resource "docker_container" "menu_web" {
  name    = "infra-menu-web"
  image   = docker_image.menu.image_id
  restart = "unless-stopped"

  # Migrate then serve. The Next.js standalone build's server is at /app/server.js
  # (Dockerfile's WORKDIR). `migrate.mjs` is copied alongside; both relative
  # to /app, the image's WORKDIR.
  command = [
    "sh",
    "-c",
    "node scripts/migrate.mjs && node server.js",
  ]

  # Runtime env is the SAME shape as dev's `.env.local` because both
  # call into `infra/modules/menu_env`. Adding a new key happens in
  # one place (the module's locals.env_map); both backends pick it up
  # mechanically on next apply.
  env = module.menu_env.env_list

  networks_advanced {
    name    = docker_network.iedora.name
    aliases = ["infra-menu-web"]
  }

  lifecycle {
    enabled = local.zitadel_bootstrapped
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [
    module.postgres,
  ]
}

resource "docker_container" "caddy" {
  name    = "infra-caddy"
  image   = "caddy:2.11-alpine"
  restart = "unless-stopped"

  # Public 80/443 bound to all host interfaces (firewall already opens these).
  ports {
    internal = 80
    external = 80
  }
  ports {
    internal = 443
    external = 443
  }

  networks_advanced {
    name    = docker_network.iedora.name
    aliases = ["infra-caddy"]
  }

  # Cert + ACME state lives in a named volume; container recreations don't
  # re-request certs (Let's Encrypt has rate limits).
  volumes {
    container_path = "/data"
    volume_name    = docker_volume.caddy_data.name
  }

  # Caddyfile delivered via upload — change → container recreation → reload.
  # The `versions h2c 2` clause forces HTTP/2 cleartext to the upstream;
  # without it Caddy speaks HTTP/1.1 and gRPC requests fail mid-stream.
  upload {
    file    = "/etc/caddy/Caddyfile"
    content = <<-EOT
      {
        # Email used for Let's Encrypt account registration + expiry warnings.
        email ${var.infra_openobserve_root_user_email}
      }

      ${var.zitadel_hostname} {
        # v2 login UI is a separate Next.js container — first-match wins,
        # so this matcher MUST come before the catch-all reverse_proxy.
        @login path /ui/v2/*
        handle @login {
          reverse_proxy http://infra-zitadel-login:3000
        }

        # Everything else (gRPC management API + REST OIDC endpoints + /admin/v1
        # console) → the Go binary. h2c is non-optional for gRPC traffic.
        handle {
          reverse_proxy http://infra-zitadel:8080 {
            transport http {
              versions h2c 2
            }
          }
        }
      }

      ${var.menu_public_hostname} {
        # Menu app (Next.js standalone). HTTP/1.1 backend, no gRPC — Caddy
        # auto-handles HTTP/2 on the client side without h2c upstream.
        reverse_proxy http://infra-menu-web:3000
      }

      # OpenObserve UI is no longer exposed publicly — ZO_LOCAL_MODE keeps
      # data on the VPS disk, and ad-hoc UI access is via an SSH tunnel:
      #   ssh -L 5080:localhost:5080 root@<vps>  → http://localhost:5080
    EOT
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [
    module.zitadel,
    module.zitadel_login,
  ]
}
