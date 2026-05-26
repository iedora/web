# Renders the full Docker Compose file that the Hetzner box runs.
#
# Every shared container (postgres, openobserve, zitadel, zitadel-login,
# caddy, backups) is declared here as a service in the compose document.
# Tofu renders the YAML; cloud-init drops it on the box at first boot
# and a single `terraform_data.iedora_sync` resource (see sync.tf) pushes
# updates on day-2 changes.
#
# The kreuzwerker/docker provider is intentionally NOT used — putting it
# on the apply graph forced multi-pass applies (SSH MaxStartups),
# state-rm dances on destroy, and known-hosts rotation on every IP
# change. Letting the box own its containers (via compose + systemd)
# collapses all of that to one SSH session that only fires when the
# rendered compose hash changes.

locals {
  # Paths inside the VPS — cloud-init writes here, the systemd unit
  # runs `docker compose -f /etc/iedora/docker-compose.yml ...`.
  iedora_etc_dir   = "/etc/iedora"
  postgres_data    = "/root/infra-postgres/data"
  openobserve_data = "/root/infra-openobserve/openobserve-data"

  # Caddyfile lives at /etc/iedora/Caddyfile, bind-mounted into the
  # caddy container at /etc/caddy/Caddyfile.
  caddyfile = templatefile("${path.module}/templates/Caddyfile", {
    acme_email       = var.infra_openobserve_root_user_email
    zitadel_hostname = var.zitadel_hostname
    menu_hostname    = var.menu_public_hostname
  })

  # init.sql lives at /etc/iedora/postgres-init/init.sql, bind-mounted
  # into the postgres container at /docker-entrypoint-initdb.d/init.sql.
  postgres_init_sql = file("${path.module}/../postgres/init.sql")

  # Compose document. yamlencode round-trips through HCL types, so the
  # diff in `tofu plan` shows the structured change rather than a raw
  # YAML blob.
  compose = {
    name = "iedora"

    networks = {
      iedora = {
        name   = "iedora"
        driver = "bridge"
      }
    }

    volumes = {
      zitadel_bootstrap = { name = "zitadel-bootstrap" }
      caddy_data        = { name = "caddy-data" }
    }

    services = {
      # ── postgres ────────────────────────────────────────────────
      postgres = {
        image          = "postgres:18.4-alpine"
        container_name = "infra-postgres"
        restart        = "unless-stopped"
        networks       = { iedora = { aliases = ["postgres", "infra-postgres"] } }
        environment = {
          POSTGRES_USER     = "postgres"
          POSTGRES_PASSWORD = random_password.postgres.result
          POSTGRES_DB       = "postgres"
        }
        volumes = [
          "${local.postgres_data}:/var/lib/postgresql",
          "${local.iedora_etc_dir}/postgres-init/init.sql:/docker-entrypoint-initdb.d/init.sql:ro",
        ]
        healthcheck = {
          test     = ["CMD-SHELL", "pg_isready -U postgres"]
          interval = "5s"
          timeout  = "5s"
          retries  = 5
        }
        logging = { driver = "json-file", options = { max-size = "10m" } }
      }

      # ── zitadel bootstrap chmod (one-shot) ──────────────────────
      # Named volumes default to root:root 755; Zitadel runs as UID
      # 1000 and the login UI as 1001. chmod 777 once, exit. Other
      # services depend on `service_completed_successfully`.
      zitadel-bootstrap = {
        image          = "busybox:1.37"
        container_name = "infra-zitadel-bootstrap"
        command        = ["chmod", "777", "/x"]
        volumes        = ["zitadel-bootstrap:/x"]
        restart        = "no"
      }

      # ── openobserve ─────────────────────────────────────────────
      openobserve = {
        image          = "public.ecr.aws/zinclabs/openobserve:v0.90.0"
        container_name = "infra-openobserve"
        restart        = "unless-stopped"
        networks       = { iedora = { aliases = ["openobserve", "infra-openobserve"] } }
        environment = {
          ZO_DATA_DIR                    = "/data"
          ZO_HTTP_PORT                   = "5080"
          ZO_GRPC_PORT                   = "5081"
          ZO_S3_PROVIDER                 = "aws"
          ZO_S3_REGION_NAME              = "auto"
          ZO_S3_BUCKET_NAME              = cloudflare_r2_bucket.data.name
          ZO_S3_BUCKET_PREFIX            = "o2"
          ZO_S3_SERVER_URL               = "https://${var.account_id}.r2.cloudflarestorage.com"
          ZO_S3_FEATURE_FORCE_PATH_STYLE = "true"
          ZO_S3_ACCESS_KEY               = cloudflare_api_token.data_r2.id
          ZO_S3_SECRET_KEY               = sha256(cloudflare_api_token.data_r2.value)
          ZO_ROOT_USER_EMAIL             = var.infra_openobserve_root_user_email
          ZO_ROOT_USER_PASSWORD          = random_password.openobserve_password.result
        }
        volumes = ["${local.openobserve_data}:/data"]
        ports   = ["127.0.0.1:5080:5080"]
        logging = { driver = "json-file", options = { max-size = "10m" } }
      }

      # ── zitadel ─────────────────────────────────────────────────
      zitadel = {
        image          = "ghcr.io/zitadel/zitadel:v4.15.0"
        container_name = "infra-zitadel"
        restart        = "unless-stopped"
        command = [
          "start-from-init",
          "--masterkeyFromEnv",
          "--tlsMode", "external",
        ]
        depends_on = {
          postgres          = { condition = "service_healthy" }
          zitadel-bootstrap = { condition = "service_completed_successfully" }
        }
        networks = { iedora = { aliases = ["zitadel", "infra-zitadel"] } }
        environment = {
          ZITADEL_EXTERNALDOMAIN                                      = var.zitadel_hostname
          ZITADEL_EXTERNALPORT                                        = "443"
          ZITADEL_EXTERNALSECURE                                      = "true"
          ZITADEL_TLS_ENABLED                                         = "false"
          ZITADEL_DATABASE_POSTGRES_HOST                              = "infra-postgres"
          ZITADEL_DATABASE_POSTGRES_PORT                              = "5432"
          ZITADEL_DATABASE_POSTGRES_DATABASE                          = "zitadel"
          ZITADEL_DATABASE_POSTGRES_AWAITINITIALCONN                  = "5m"
          ZITADEL_DATABASE_POSTGRES_USER_USERNAME                     = "postgres"
          ZITADEL_DATABASE_POSTGRES_USER_PASSWORD                     = random_password.postgres.result
          ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE                     = "disable"
          ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME                    = "postgres"
          ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD                    = random_password.postgres.result
          ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE                    = "disable"
          ZITADEL_DATABASE_POSTGRES_ADMIN_EXISTINGDATABASE            = "postgres"
          ZITADEL_FIRSTINSTANCE_ORG_NAME                              = "iedora"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME                    = "eduvhc"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_FIRSTNAME                   = "iedora"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_LASTNAME                    = "Admin"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_ADDRESS               = "eduardoferdcarvalho@gmail.com"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_VERIFIED              = "true"
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD                    = random_password.zitadel_first_admin.result
          ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORDCHANGEREQUIRED      = "true"
          ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_USERNAME      = "login-client"
          ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_MACHINE_NAME          = "Login Client"
          ZITADEL_FIRSTINSTANCE_ORG_LOGINCLIENT_PAT_EXPIRATIONDATE    = "2099-01-01T00:00:00Z"
          ZITADEL_FIRSTINSTANCE_LOGINCLIENTPATPATH                    = "/zitadel-bootstrap/login-client.pat"
          ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME          = "zitadel-admin-sa"
          ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME              = "Terraform"
          ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_TYPE           = "1"
          ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_EXPIRATIONDATE = "2099-01-01T00:00:00Z"
          ZITADEL_FIRSTINSTANCE_MACHINEKEYPATH                        = "/zitadel-bootstrap/zitadel-admin-sa.json"
          ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED           = "true"
          ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_BASEURI            = "https://${var.zitadel_hostname}/ui/v2/login"
          ZITADEL_MASTERKEY                                           = random_password.zitadel_masterkey.result
        }
        volumes = ["zitadel-bootstrap:/zitadel-bootstrap"]
        logging = { driver = "json-file", options = { max-size = "10m" } }
      }

      # ── zitadel-login ───────────────────────────────────────────
      zitadel-login = {
        image          = "ghcr.io/zitadel/zitadel-login:v4.15.0"
        container_name = "infra-zitadel-login"
        restart        = "unless-stopped"
        depends_on     = { zitadel = { condition = "service_started" } }
        networks       = { iedora = { aliases = ["zitadel-login", "infra-zitadel-login"] } }
        environment = {
          ZITADEL_API_URL                 = "https://${var.zitadel_hostname}"
          NEXT_PUBLIC_BASE_PATH           = "/ui/v2/login"
          ZITADEL_SERVICE_USER_TOKEN_FILE = "/zitadel-bootstrap/login-client.pat"
          ZITADEL_TLS_ENABLED             = "false"
          EMAIL_VERIFICATION              = "false"
        }
        extra_hosts = ["${var.zitadel_hostname}:host-gateway"]
        volumes     = ["zitadel-bootstrap:/zitadel-bootstrap:ro"]
        logging     = { driver = "json-file", options = { max-size = "10m" } }
      }

      # ── caddy ───────────────────────────────────────────────────
      caddy = {
        image          = "caddy:2.11-alpine"
        container_name = "infra-caddy"
        restart        = "unless-stopped"
        depends_on = {
          zitadel       = { condition = "service_started" }
          zitadel-login = { condition = "service_started" }
        }
        networks = { iedora = { aliases = ["infra-caddy"] } }
        ports    = ["80:80", "443:443"]
        volumes = [
          "caddy-data:/data",
          "${local.iedora_etc_dir}/Caddyfile:/etc/caddy/Caddyfile:ro",
        ]
        logging = { driver = "json-file", options = { max-size = "10m" } }
      }

      # ── backups ─────────────────────────────────────────────────
      backups = {
        image          = "ghcr.io/${var.github_owner}/iedora-backup:18"
        container_name = "infra-backups"
        restart        = "unless-stopped"
        networks       = { iedora = {} }
        environment = {
          SCHEDULE             = "@daily"
          BACKUP_KEEP_DAYS     = "14"
          S3_REGION            = "auto"
          S3_ENDPOINT          = "https://${var.account_id}.r2.cloudflarestorage.com"
          S3_BUCKET            = cloudflare_r2_bucket.data.name
          S3_PREFIX            = "pg"
          POSTGRES_HOST        = "infra-postgres"
          POSTGRES_DATABASE    = ""
          POSTGRES_USER        = "postgres"
          POSTGRES_PASSWORD    = random_password.postgres.result
          S3_ACCESS_KEY_ID     = cloudflare_api_token.data_r2.id
          S3_SECRET_ACCESS_KEY = sha256(cloudflare_api_token.data_r2.value)
          PASSPHRASE           = random_password.backup_passphrase.result
        }
        logging = { driver = "json-file", options = { max-size = "10m" } }
      }
    }
  }

  compose_yaml = yamlencode(local.compose)
}
