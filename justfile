# Iedora monorepo — root entry point.
#
# Each product is self-contained under products/<name>/, with its own
# justfile, Tofu root, and .env. This file exposes them as just modules:
#
#   just infra::deploy          → cd infra/ && just deploy (shared Postgres + backups)
#   just menu::deploy           → cd products/menu/infra/ && just deploy
#   just menu::logs             → docker logs for the menu container
#   just house::deploy          → cd products/house/infra/ && just deploy
#   just menu                   → list menu's recipes
#   just                        → list this file (and the modules below)
#
# `infra::` MUST be applied before any product's deploy on a fresh box
# — products' apps connect to `infra-postgres:5432`, which infra owns.
#
# Add a 3rd product:
#   1. mkdir products/<name>/
#   2. cp products/house/infra/{justfile,bin/with-secrets,.env.example} into it
#   3. echo "mod <name> 'products/<name>/infra'" appended to this file

mod infra 'infra'
mod house 'products/house/infra'
# No `mod menu` — menu's deploy (container + R2 + DNS) lives entirely in
# the shared `infra/tofu/` root since the R2 consolidation. The dev loop
# lives at `infra/dev/`. Per-product Tofu disappeared with the
# iedora-data / iedora-assets bucket merge.

# Default: list modules + recipes.
[private]
_default:
    @just --list

# Boot the dev stack — everything (or a subset, via -i / --only / --except).
# Pure OpenTofu — `infra/dev/tofu/` calls the shared `infra/modules/services/*`
# modules with dev inputs (local docker daemon, host-published ports,
# LocalStack instead of R2). No docker-compose.
[doc("boot the dev stack via OpenTofu")]
dev *ARGS:
    @cd infra/dev && go run . {{ARGS}}

# Tear the dev stack down + wipe its volumes. Use before a clean
# re-bootstrap when you want fresh PATs / fresh Zitadel DB.
[doc("wipe the dev stack (containers + network + volumes + PATs + .env.local)")]
dev-down:
    -cd infra/dev/tofu && tofu destroy -auto-approve -var zitadel_pat="" 2>/dev/null
    -docker ps -aq --filter "name=infra-" | xargs -r docker rm -f
    -docker network rm iedora 2>/dev/null
    -docker volume rm postgres-data localstack-data openobserve-data 2>/dev/null
    rm -rf infra/dev/.zitadel-bootstrap
    rm -rf infra/dev/tofu/.terraform infra/dev/tofu/.terraform.lock.hcl infra/dev/tofu/terraform.tfstate*
    rm -f products/menu/.env.local
