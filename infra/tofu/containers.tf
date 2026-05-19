# Homelab infrastructure containers — postgres, openobserve, zitadel, the
# backups job, and the two cloudflared sidecars. End-app deploys (menu)
# still go through Kamal; this file owns the always-on layer.
#
# Why Tofu and not Kamal:
#   - Kamal's accessory model is built around per-product rollouts (one
#     service, one image, one cmd). The infra layer is multi-service +
#     long-lived, and we want declarative drift detection (infra/CLAUDE.md
#     hard rule #1). Kamal's accessory secrets file is one-shell-namespace
#     which makes two cloudflared sidecars awkward; Tofu reads tunnel
#     tokens directly from `module.*.token` and writes them to env.
#   - One workspace, one apply. Adding a new service is one resource block.
#
# Data preservation across the Kamal → Tofu cutover:
#   Postgres + OpenObserve keep their data via the SAME bind-mount paths
#   Kamal used (/root/infra-postgres/data, /root/infra-openobserve/data).
#   Tofu creates new containers, mounts the same paths → cluster boots
#   with menu + zitadel DBs already there.
#
# Network:
#   `docker_network.kamal` keeps the name "kamal" so menu's Kamal-managed
#   app container (which auto-creates that network) still resolves
#   `infra-postgres`, `infra-openobserve`, `infra-zitadel` by name.

# ── Network ──────────────────────────────────────────────────────────────────

resource "docker_network" "kamal" {
  name   = "kamal"
  driver = "bridge"

  # Kamal would create this lazily on first app boot. We declare it
  # explicitly here so Tofu owns the lifecycle; Kamal sees a network of
  # the same name already exists and uses it.
  lifecycle {
    # Don't destroy the network on `tofu destroy` — the menu-web app
    # container may still be attached and Docker refuses.
    # Manual cleanup if ever needed: `docker network rm kamal`.
    prevent_destroy = true
  }

  # Every other docker_* resource in this file references either this
  # network or the bootstrap volume, so chaining the docker readiness
  # barrier through these two foundational resources transitively gates
  # every container behind cloud-init finishing on the Hetzner box.
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
# survives the Kamal-to-Tofu cutover. The dir was created by Kamal's
# `directories: - data:/var/lib/postgresql` convention and currently holds
# the menu and zitadel databases.

resource "docker_container" "postgres" {
  name    = "infra-postgres"
  image   = "postgres:18.4-alpine"
  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=postgres",
    "POSTGRES_PASSWORD=${var.infra_postgres_password}",
    # Bootstrap DB only — the menu / zitadel databases are created by
    # ../postgres/init.sql on a TRULY empty data dir.
    "POSTGRES_DB=postgres",
  ]

  networks_advanced {
    name    = docker_network.kamal.name
    aliases = ["infra-postgres"]
  }

  volumes {
    container_path = "/var/lib/postgresql"
    host_path      = "/root/infra-postgres/data"
  }

  # On a brand-new homelab, postgres reads /docker-entrypoint-initdb.d/*.sql
  # on the cluster's first init. Re-runs are no-ops once the data dir is
  # populated, so it's safe to keep mounted across deploys.
  upload {
    file    = "/docker-entrypoint-initdb.d/init.sql"
    content = file("${path.module}/../postgres/init.sql")
  }

  log_opts = {
    max-size = "10m"
  }
}

# ── OpenObserve (observability backend) ──────────────────────────────────────

resource "docker_container" "openobserve" {
  name    = "infra-openobserve"
  image   = "public.ecr.aws/zinclabs/openobserve:v0.80.3"
  restart = "unless-stopped"

  env = [
    "ZO_LOCAL_MODE=true",
    "ZO_DATA_DIR=/data",
    "ZO_HTTP_PORT=5080",
    "ZO_GRPC_PORT=5081",
    "ZO_S3_PROVIDER=aws",
    "ZO_S3_REGION_NAME=auto",
    "ZO_S3_BUCKET_NAME=${cloudflare_r2_bucket.observability.name}",
    "ZO_S3_SERVER_URL=https://${var.account_id}.r2.cloudflarestorage.com",
    "ZO_S3_FEATURE_FORCE_PATH_STYLE=true",
    "ZO_S3_ACCESS_KEY=${cloudflare_api_token.observability_r2.id}",
    "ZO_S3_SECRET_KEY=${sha256(cloudflare_api_token.observability_r2.value)}",
    "ZO_ROOT_USER_EMAIL=${var.infra_openobserve_root_user_email}",
    "ZO_ROOT_USER_PASSWORD=${var.infra_openobserve_root_user_password}",
  ]

  networks_advanced {
    name    = docker_network.kamal.name
    aliases = ["infra-openobserve"]
  }

  volumes {
    container_path = "/data"
    host_path      = "/root/infra-openobserve/openobserve-data"
  }

  log_opts = {
    max-size = "10m"
  }
}

resource "docker_container" "openobserve_tunnel" {
  name    = "infra-openobserve-tunnel"
  image   = "cloudflare/cloudflared:2026.5.0@sha256:59bab8d3aceec09bf6bdb07d6beca0225ca5cd7ab79436a87ea97978fe1dc4f9"
  restart = "unless-stopped"

  command = [
    "tunnel",
    "--no-autoupdate",
    "run",
    "--token", module.observability_tunnel.token,
  ]

  networks_advanced {
    name = docker_network.kamal.name
  }

  log_opts = {
    max-size = "10m"
  }
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
    "S3_BUCKET=${cloudflare_r2_bucket.backups.name}",
    "S3_PREFIX=pg",
    "POSTGRES_HOST=infra-postgres",
    # Empty → backup.sh uses --all-databases (every iedora product).
    "POSTGRES_DATABASE=",
    "POSTGRES_USER=postgres",
    "POSTGRES_PASSWORD=${var.infra_postgres_password}",
    "S3_ACCESS_KEY_ID=${cloudflare_api_token.backups_r2.id}",
    "S3_SECRET_ACCESS_KEY=${sha256(cloudflare_api_token.backups_r2.value)}",
    "PASSPHRASE=${var.infra_backup_passphrase}",
  ]

  networks_advanced {
    name = docker_network.kamal.name
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

resource "docker_container" "zitadel" {
  name    = "infra-zitadel"
  image   = "ghcr.io/zitadel/zitadel:v4.15.0"
  restart = "unless-stopped"

  command = [
    "start-from-init",
    "--masterkeyFromEnv",
    "--tlsMode", "external",
  ]

  env = [
    # External-facing config.
    "ZITADEL_EXTERNALDOMAIN=${var.zitadel_hostname}",
    "ZITADEL_EXTERNALPORT=443",
    "ZITADEL_EXTERNALSECURE=true",
    "ZITADEL_TLS_ENABLED=false",

    # Postgres connection — User and Admin both reuse the `postgres`
    # superuser (matches menu).
    "ZITADEL_DATABASE_POSTGRES_HOST=infra-postgres",
    "ZITADEL_DATABASE_POSTGRES_PORT=5432",
    "ZITADEL_DATABASE_POSTGRES_DATABASE=zitadel",
    # Retry for up to 5 min on first connect so we tolerate postgres
    # taking longer to come up than zitadel (Tofu creates them in
    # parallel; image start order is not guaranteed).
    "ZITADEL_DATABASE_POSTGRES_AWAITINITIALCONN=5m",
    "ZITADEL_DATABASE_POSTGRES_USER_USERNAME=postgres",
    "ZITADEL_DATABASE_POSTGRES_USER_PASSWORD=${var.infra_postgres_password}",
    "ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE=disable",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME=postgres",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD=${var.infra_postgres_password}",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE=disable",
    "ZITADEL_DATABASE_POSTGRES_ADMIN_EXISTINGDATABASE=postgres",

    # FirstInstance bootstrap (setup viper namespace).
    "ZITADEL_FIRSTINSTANCE_ORG_NAME=iedora",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME=zitadel-admin",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_FIRSTNAME=iedora",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_LASTNAME=Admin",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_ADDRESS=eduardoferdcarvalho@gmail.com",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_VERIFIED=true",
    "ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD=${var.infra_zitadel_first_admin_password}",
    # PasswordChangeRequired=true would force a change on first login,
    # which the v2 login UI handles natively. Leaving the steps.yaml
    # default (true) is fine.

    # Login-client service user — bootstraps with a 75-year PAT written
    # to the shared volume. zitadel-login reads it via
    # ZITADEL_SERVICE_USER_TOKEN_FILE.
    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_USERNAME=login-client",
    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_NAME=Login Client",
    "ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_PAT_EXPIRATIONDATE=2099-01-01T00:00:00Z",
    "ZITADEL_FIRSTINSTANCE_LOGINCLIENTPATPATH=/zitadel-bootstrap/login-client.pat",

    # Terraform machine user — IAM_OWNER service account whose JSON key
    # the `zitadel/zitadel` Tofu provider authenticates with. The key is
    # written to the shared bootstrap volume on first init; bin/with-secrets
    # fetches it once and uploads to BWS, after which it flows declaratively
    # via TF_VAR_infra_zitadel_sa_key_json → provider.jwt_profile_json.
    # FirstInstance grants IAM_OWNER automatically (cmd/setup/steps.yaml).
    # Type=1 == JSON key (vs Type=2 == public-key-only, no use to us).
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME=zitadel-admin-sa",
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME=Terraform",
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_TYPE=1",
    "ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_EXPIRATIONDATE=2099-01-01T00:00:00Z",
    "ZITADEL_FIRSTINSTANCE_MACHINEKEYPATH=/zitadel-bootstrap/zitadel-admin-sa.json",

    # Login V2 BaseURI — the main binary's redirects MUST point here, the
    # path-routed tunnel rule will land them on zitadel-login.
    "ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=true",
    "ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_BASEURI=https://${var.zitadel_hostname}/ui/v2/login",

    # Masterkey — encrypts every internal secret (signing keys, OAuth
    # client secrets, action target keys). Loss == ciphertext is dead.
    "ZITADEL_MASTERKEY=${var.infra_zitadel_masterkey}",
  ]

  networks_advanced {
    name    = docker_network.kamal.name
    aliases = ["infra-zitadel"]
  }

  volumes {
    container_path = "/zitadel-bootstrap"
    volume_name    = docker_volume.zitadel_bootstrap.name
  }

  log_opts = {
    max-size = "10m"
  }

  # The bootstrap volume must be chmodded before FirstInstance tries to
  # write the login-client PAT — see docker_container.zitadel_bootstrap_chmod.
  depends_on = [
    docker_container.postgres,
    docker_container.zitadel_bootstrap_chmod,
  ]
}

# Login UI v2 — Next.js companion to the main binary. Path /ui/v2/* on the
# tunnel routes here; everything else stays on the binary. Reads the PAT
# from the shared bootstrap volume.

resource "docker_container" "zitadel_login" {
  name    = "infra-zitadel-login"
  image   = "ghcr.io/zitadel/zitadel-login:v4.15.0"
  restart = "unless-stopped"

  env = [
    "ZITADEL_API_URL=http://infra-zitadel:8080",
    "NEXT_PUBLIC_BASE_PATH=/ui/v2/login",
    "ZITADEL_SERVICE_USER_TOKEN_FILE=/zitadel-bootstrap/login-client.pat",
    "ZITADEL_TLS_ENABLED=false",
    "EMAIL_VERIFICATION=false",
  ]

  networks_advanced {
    name    = docker_network.kamal.name
    aliases = ["infra-zitadel-login"]
  }

  volumes {
    container_path = "/zitadel-bootstrap"
    volume_name    = docker_volume.zitadel_bootstrap.name
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [docker_container.zitadel]
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

# ── Menu app (Next.js SaaS — was Kamal-managed until 2026-05-20) ─────────────
# Pulled from GHCR's `:latest` tag (CI pushes on every successful merge to
# main). The `docker_registry_image` data source queries the live digest, so
# `pull_triggers` flips whenever CI publishes a new image — Tofu force-replaces
# the container on the next apply.
#
# No SHA pinning in HCL: trade-off for zero chicken-egg (no need to write SHA
# back through BWS after every CI run). The downside is `tofu plan` against a
# fresh GHCR push always shows a replace, even if you're applying for an
# unrelated reason. Acceptable for a single-app workspace; if menu ever
# regresses on a deploy we still have R2 dumps to roll back the Postgres data.
#
# Migrations: `node scripts/migrate.mjs` holds a `pg_advisory_lock` so a
# rolling restart (multiple replicas one day) doesn't double-migrate. It's
# safe to re-run on a populated DB — same idempotency as Kamal had.

data "docker_registry_image" "menu" {
  name = "ghcr.io/${var.github_owner}/menu:latest"
}

resource "docker_image" "menu" {
  name          = data.docker_registry_image.menu.name
  pull_triggers = [data.docker_registry_image.menu.sha256_digest]

  # Keeping the image cached on the host across container recreations cuts
  # restart time. Tofu re-pulls only when the upstream digest changes.
  keep_locally = true
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

  env = [
    "NEXT_TELEMETRY_DISABLED=1",
    "BETTER_AUTH_URL=https://${var.menu_public_hostname}",
    "BETTER_AUTH_SECRET=${var.menu_auth_secret}",
    "DATABASE_URL=postgres://postgres:${var.infra_postgres_password}@infra-postgres:5432/menu",
    # OIDC client — points at the Zitadel-issued credentials. During the
    # genkan→Zitadel transition window (Phase 3 of #19) menu's OIDC flow is
    # not functional; values are passed so the container boots cleanly.
    "ZITADEL_OAUTH_CLIENT_ID=${var.menu_oauth_client_id}",
    "ZITADEL_OAUTH_CLIENT_SECRET=${var.menu_oauth_client_secret}",
    # R2 assets bucket — Tofu-managed in products/menu/infra/tofu/.
    "S3_ENDPOINT=${var.infra_menu_assets_endpoint}",
    "S3_REGION=us-east-1",
    "S3_BUCKET=${var.infra_menu_assets_bucket}",
    "S3_ACCESS_KEY=${var.infra_menu_assets_access_key}",
    "S3_SECRET_KEY=${var.infra_menu_assets_secret_key}",
    # OpenObserve OTLP — same `kamal` network, container-DNS reachable.
    "OTEL_EXPORTER_OTLP_ENDPOINT=http://infra-openobserve:5080/api/default",
    "OTEL_EXPORTER_OTLP_HEADERS=${var.infra_openobserve_ingest_header}",
    "HOST_NAME=${hcloud_server.iedora.name}",
  ]

  networks_advanced {
    name    = docker_network.kamal.name
    aliases = ["infra-menu-web"]
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [
    docker_container.postgres,
  ]
}

resource "docker_container" "caddy" {
  name    = "infra-caddy"
  image   = "caddy:2.10-alpine"
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
    name    = docker_network.kamal.name
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
    file = "/etc/caddy/Caddyfile"
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
    EOT
  }

  log_opts = {
    max-size = "10m"
  }

  depends_on = [
    docker_container.zitadel,
    docker_container.zitadel_login,
  ]
}
