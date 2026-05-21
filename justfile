# Iedora monorepo — root entry point.
#
# Three flat recipes for everything you do day-to-day:
#
#   just deploy [FLAGS]       apply the infra estate (Pass 1/2/3 via Go orchestrator)
#   just deploy --destroy     tear it down (flag handled in Go — same binary, same code)
#   just deploy -d            short form of --destroy
#   just dev [FLAGS]          bring up the local dev stack (OpenTofu, no docker-compose)
#   just dev --destroy        tear the dev stack down
#   just doctor               preflight: PATH, BWS auth, bootstrap secrets present
#
# Single dispatch point per axis: the justfile passes flags straight to
# the Go binary; Go decides what to do with --destroy. No bash branching.
#
# Per-product modules below (`just house::…`). Menu has no module — its
# deploy (container + R2 + DNS) lives entirely in the shared `infra/tofu/`
# root, the dev loop lives in `infra/cmd/dev/`. Per-product Tofu
# disappeared with the iedora-data / iedora-assets bucket merge.
#
# Day-2 ops on the Hetzner box — operator-side ad-hoc SSH:
#
#   HOST=$(cd infra && bin/with-secrets tofu -chdir=tofu output -raw hetzner_ipv4)
#   ssh root@$HOST docker logs -f --tail=200 infra-<svc>           # logs
#   ssh -t root@$HOST docker exec -it infra-postgres psql -U postgres
#   ssh root@$HOST docker exec infra-backups sh /backup.sh         # pg_dump now
#   ssh -t root@$HOST docker exec -it infra-backups sh /restore.sh # restore

# `just deploy` runs the shared infra Tofu root which OWNS the menu app
# container. House (Astro on Cloudflare Workers) deploys via its own CI
# workflow (`.github/workflows/house-deploy.yml`) on push to main — no
# root-level recipe needed. For ad-hoc local house deploys, work from
# its own justfile: `cd products/house/infra && just deploy`.

# Default: list recipes.
[private]
_default:
    @just --list

# Apply (or, with --destroy, tear down) every infra resource: Hetzner VPS
# + Cloudflare R2 + DNS + GitHub Actions config + every Docker container.
# Thin shim over the Go orchestrator at `infra/cmd/iedora` — every Pass
# 1/2/3 detail, the cert-ready probe, the DNS-override CONNECT proxy
# that sidesteps the macOS NXDOMAIN cache, and the BWS write-through of
# INFRA_HOST_IP live there.
#
# Flags pass straight through to `bin/iedora deploy`:
#   -d, --destroy         tear down (same binary handles both directions)
#       --skip-init       skip leading `tofu init` (CI flag)
#       --ready-budget    cap the Zitadel /debug/ready + LE cert wait (default 6m)
[doc("apply the infra estate (--destroy / -d to tear it down)")]
deploy *FLAGS:
    @cd infra && bin/iedora deploy {{FLAGS}}

# Boot the local dev stack — everything (or a subset, via -i / --only / --except).
# Pure OpenTofu — `infra/dev/tofu/` calls the shared `infra/modules/services/*`
# modules with dev inputs (local docker daemon, host-published ports,
# LocalStack instead of R2). No docker-compose.
#
# Modes:
#   just dev                   bring everything up (~30s cold, ~5s warm)
#   just dev --destroy         tear the dev stack down (was `just dev-down`)
#   just dev --reset-db menu   drop + recreate the menu DB only (fast)
#   just dev --reset-db zitadel   full Zitadel rebootstrap (~30s — touches bootstrap volume)
#   just dev --only menu       boot menu + its transitive deps
#   just dev --except menu     boot everything except menu (for HMR via bun run dev)
#
# See docs/dev.md for the full flag table.
[doc("boot the dev stack (--destroy / --reset-db <svc> / --only / --except)")]
dev *FLAGS:
    @cd infra && go run ./cmd/dev {{FLAGS}}

# Preflight check — runs locally, no mutation. Verifies bws + tofu + ssh
# are on PATH, BWS auth works, and every required bootstrap secret is in
# the iedora-deploy project. Cheap to run before `deploy` if you're not
# sure the environment is set up.
[doc("preflight check: PATH, BWS auth, bootstrap secrets present")]
doctor:
    @cd infra && bin/iedora doctor

# BWS env wrapper — exec any command with every BWS secret hydrated into
# env (+ TF_VAR_* aliases for the bootstrap-secret shape Tofu expects).
# Useful for ad-hoc `tofu state` operations and one-off
# `apply -replace=<resource>` runs without dragging the whole orchestrator.
#
# Examples:
#   just with-secrets tofu -chdir=tofu state list
#   just with-secrets tofu -chdir=tofu apply -replace=random_password.postgres
#   just with-secrets bash -c 'echo $TF_VAR_state_passphrase'
#
# Same wrapper bin/iedora layers on top — exposing it here means you don't
# have to `cd infra && bin/with-secrets …` for the day-to-day cases.
[doc("exec a command with every BWS secret + TF_VAR_* hydrated into env")]
with-secrets *CMD:
    @cd infra && bin/with-secrets {{CMD}}

# iedora-admin role-grant helper. Looks up admin emails in Zitadel and
# POSTs the iedora-admin project-role grant for each one. Idempotent —
# every `just deploy` re-runs it via a Tofu `null_resource` + local-exec
# whenever `var.iedora_admin_emails` changes. This recipe is the ad-hoc
# escape hatch: re-run the grants without a full apply (e.g. after a user
# self-provisions via OIDC and you want their role landed now).
#
# Env vars expected (see `infra/cmd/zitadel-grant/main.go` godoc):
#   ZG_HOSTNAME, ZG_SCHEME, ZG_TOKEN, ZG_ORG_ID, ZG_PROJECT_ID, ZG_ROLE_KEY, ZG_EMAILS
# Caller responsibility — the recipe is a transparent dispatcher.
[doc("re-run the iedora-admin grants helper (env-driven — see cmd godoc)")]
zitadel-grant *ARGS:
    @cd infra && bin/zitadel-grant {{ARGS}}
