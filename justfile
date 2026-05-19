# Iedora monorepo — root entry point.
#
# Each product is self-contained under products/<name>/, with its own
# justfile, Tofu root, and .env. This file exposes them as just modules:
#
#   just infra::deploy          → cd infra/ && just deploy (shared Postgres + backups)
#   just menu::deploy           → cd products/menu/infra/ && just deploy
#   just menu::logs             → same, kamal app logs
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
