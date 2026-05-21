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
#   2. cp products/house/infra/{justfile,bin/with-secrets} into it.
#      The wrapper auto-discovers BWS_PROJECT_ID + CLOUDFLARE_ACCOUNT_ID;
#      operator only needs BWS_ACCESS_TOKEN in shell.
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
#
# Single entry point. `just dev --destroy` tears the stack down (was the
# old `just dev-down` recipe; folded into the Go orchestrator).
[doc("boot the dev stack via OpenTofu (--destroy to wipe everything)")]
dev *ARGS:
    @cd infra && go run ./cmd/dev {{ARGS}}
