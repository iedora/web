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
mod menu 'products/menu/infra'
mod house 'products/house/infra'

# Default: list modules + recipes.
[private]
_default:
    @just --list

# Start the full menu dev stack: docker compose (postgres + localstack +
# zitadel) → tofu seed → drizzle migrate → next dev. Equivalent to
# `cd products/menu && bun run dev`. Lives at the root because the dev
# infra is transversal across products — `infra/dev/dev.go` is the
# orchestrator.
[doc("boot the full menu dev stack")]
dev:
    @go run infra/dev/dev.go

# Tear the dev stack down + wipe its volumes. Use before a clean
# re-bootstrap when you want fresh PATs / fresh Zitadel DB.
[doc("wipe the dev stack (volumes + bootstrap PATs + .env.local)")]
dev-down:
    docker compose -f infra/dev/docker-compose.yml down -v
    rm -rf infra/dev/.zitadel-bootstrap
    rm -rf infra/dev/tofu/.terraform infra/dev/tofu/.terraform.lock.hcl infra/dev/tofu/terraform.tfstate*
    rm -f products/menu/.env.local
