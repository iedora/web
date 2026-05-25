# Guardrails — implementation plan

> Companion to [deploy.md § Environment guardrails](./deploy.md#environment-guardrails).
> The guardrails doc says **what** the rules are. This doc says **how**
> we get there from today's code. One section per rule; each ends with
> a concrete, ordered task list and the files that change.
>
> Order of recommended landing: ~~Rule 5 → Rule 1 → Rule 2~~ → Rule 3 → Rule 4.
> Rules 1, 2, and 5 landed (this doc tracks each). Rules 3 and 4 are
> independent and can land in either order.

## Status at a glance

| Rule | Title                              | Status      | Effort | Blast radius |
|------|------------------------------------|-------------|--------|--------------|
| 1    | Binary environment (`local`/`live`)| ✅ landed   | —      | done in `ab72194` |
| 5    | Zitadel anti-panic lock            | ✅ landed   | —      | done — see this doc § Rule 5 |
| 2    | Tofu state in R2                   | ✅ landed   | —      | done — see this doc § Rule 2 |
| 3    | Expand-contract migrations         | Not started | M      | Medium — process + lint |
| 4    | Zero-downtime hot-swap             | Not started | M      | Medium — `runtime_docker.go` rewrite |

## Rule 1 — binary environment ✅ landed (`ab72194`)

Single source of truth: [`internal/mode`](../internal/mode/) —
`Mode` enum (`Local | Live`), `Resolve` / `MustResolve` / `Require`
(panics on mismatch) / `IsLive` / `IsLocal`. Adopted across all 5
binaries:

- `cmd/iedora` — pinned to `Live`, with `Require(Live)` at the top of
  every destructive entry point (`runIacApply`, `runIacDestroy`,
  `runAppApply`, `runDeployProduct`, `runDestroyProduct`).
- `cmd/local` — pinned to `Local`.
- `cmd/zitadel-apply` — the only dual-mode binary; takes `--mode
  live|local` (default `live`). Mode plumbs through `loadConfig`,
  `buildStore` (live → `bwsStore`, local → `memoryStore`), `ensureSAKey`,
  and `waitForMenuDNS` (local short-circuits).
- `cmd/menu-db-migrations`, `cmd/openobserve-dashboards` — live-only
  by deployment topology; `const runsIn = mode.Live` documents it.

No back-compat surface — fresh ecosystem, no callers needed a
deprecation window.

## Rule 2 — Tofu state in R2 ✅ landed

### What landed

OpenTofu `s3` backend pointed at the new `iedora-tofu-state` R2 bucket
(EEUR). Two roots share the bucket with different keys:

- `infra/tofu/` → key `infra/tofu/terraform.tfstate`
- `products/house/infra/tofu/` → key `products/house/infra/tofu/terraform.tfstate`

Concurrency is R2-native via OpenTofu 1.10+ `use_lockfile = true` (no
DynamoDB lock table — R2 has no equivalent). The `encryption {}` block
stays — R2 sees encrypted bytes, never plaintext.

### Bootstrap

`deploy/state-bucket-bootstrap/` is the one-shot Go binary that
solves the chicken/egg: it creates the R2 bucket + scoped API token
via the Cloudflare API and writes the credentials to BWS. Idempotent
— warm runs rotate the token value in place so BWS converges. Run
once per fresh ecosystem via `bin/with-secrets --stage iac --
bin/state-bucket-bootstrap`.

The scoped token has only `Workers R2 Storage Bucket Item Write` on
the single state bucket — same permission group ID as the data/assets
buckets in `infra/tofu/main.tf`.

### BWS surface

Three new keys, taxonomy `IAC_BOOTSTRAP_TOFU_STATE_*`:

| Key | Value |
|-----|-------|
| `IAC_BOOTSTRAP_TOFU_STATE_ACCESS_KEY` | Cloudflare API token ID (= S3 access key) |
| `IAC_BOOTSTRAP_TOFU_STATE_SECRET_KEY` | hex(sha256(token value)) (= S3 secret key) |
| `IAC_BOOTSTRAP_TOFU_STATE_BUCKET` | `iedora-tofu-state` (literal, for sanity-checking) |

`bin/with-secrets --stage iac` and `--stage deploy` both export these
as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` so the s3 backend
authenticates without per-workflow boilerplate.

### Migration (executed once on the fresh ecosystem)

1. `task down` against the old local-state setup (the backend block was
   stashed during destroy).
2. `bin/with-secrets --stage iac -- bin/state-bucket-bootstrap` — R2
   bucket + token + BWS keys.
3. `git rm --cached` both `terraform.tfstate` files; `rm -rf
   .terraform/` from both roots so init starts clean.
4. `task up` cold against the empty R2 bucket — init creates the state
   object, apply lands 34 resources, configurators run, deploys ship.

Smoke-tested green: `menu.iedora.com/up` → 200 `{"ok":true,"db":"ok"}`,
`auth.iedora.com/debug/ready` → 200, `iedora.com` → 200.

### Files

- [`deploy/state-bucket-bootstrap/`](../deploy/state-bucket-bootstrap/) — Go binary (main.go, r2_bucket.go, r2_token.go, main_test.go).
- [`internal/cloudflare/r2_bucket.go`](../internal/cloudflare/r2_bucket.go) + [`api_token.go`](../internal/cloudflare/api_token.go) — helpers added during the work.
- [`infra/bin/state-bucket-bootstrap`](../infra/bin/state-bucket-bootstrap) — wrapper shim.
- [`infra/tofu/versions.tf`](../infra/tofu/versions.tf) + [`products/house/infra/tofu/versions.tf`](../products/house/infra/tofu/versions.tf) — `backend "s3"` blocks.
- [`deploy/with-secrets/env.go`](../deploy/with-secrets/env.go) — new BWS keys + AWS_* env aliases.
- `.github/workflows/infra-deploy.yml` + `deploy.yml` — commit-back steps removed; `permissions: contents: write` → `read`.
- `.gitignore` — state files excluded; build-artefact binary list extended.
- State files `git rm --cached`'d.

### Follow-up surfaced

- `cloudflare.R2S3Credentials` (the older `verify`-roundtrip helper) and
  the bootstrap's inline `sha256Hex` overlap. Worth extracting
  `cloudflare.SecretFromTokenValue(value)` so both call sites share the
  formula.
- The R2-bucket-item-write permission group ID is duplicated as a Go
  const and a Tofu local. Acceptable today; long-term a `//go:generate`
  driven by `tofu output` would eliminate drift risk.

## Rule 3 — expand-contract migrations ✅ landed

### What landed

A regex-based SQL linter in `app-state/menu-db-migrations/lint.go`
scans every `.sql` file under `products/menu/drizzle/` before the
`menu-db-migrations` configurator SSHes to the box. The matcher
catches five destructive patterns:

- `DROP COLUMN`
- `DROP TABLE`
- `ALTER COLUMN ... TYPE`
- `RENAME COLUMN`
- `RENAME TABLE`

Each destructive statement must carry a marker comment **in its own
`--> statement-breakpoint` block** to pass lint:

```sql
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."old" CASCADE;
```

The grammar is `phase=<expand|migrate-data|contract>` plus an optional
`references=<expand-tag>`. Only `phase=contract` with a non-empty
`references=` unblocks a destructive statement; the other phases are
advisory (operator can label expand/migrate-data migrations for
downstream tooling, but they don't suppress lint errors).

Mode-aware gate (`gateMigrations`):

- **Live**: violations are a hard fail. The error names every
  violation with file:statement, the matched pattern, the rejection
  reason, and a recovery hint pointing at `docs/deploy.md § Rule 3`.
- **Local**: violations log to stderr but don't block. (Operator
  iterating on a destructive migration shouldn't have to commit +
  annotate every loop.)

### Retroactive annotation

`products/menu/drizzle/0001_drop_better_auth_tables.sql` was already
deployed before Rule 3 landed — it carries five `DROP TABLE` statements
that drop the better-auth tables retired by the Zitadel migration. The
file is now annotated with five `phase=contract references=0000_init`
markers (one per statement block). The integration test
`TestLintRealMigrations` keeps the annotation honest — if anyone
removes the markers, that test fails before the destructive migration
ever runs in live.

### What we *didn't* build

The original plan called for a `products/menu/drizzle/expand-contract.yaml`
registry that linked expand migrations to their contract pair and
verified the contract was at least one deploy later. Skipped: the
inline `references=<tag>` field already documents the linkage in the
SQL, and a separate registry would drift against the source of truth.
The integration test (`TestLintRealMigrations`) plus a future
`TestExpandContractPairing` (when we have the second contract migration
to test against) cover the verification surface adequately.

### Files

- [`app-state/menu-db-migrations/lint.go`](../app-state/menu-db-migrations/lint.go) — matcher + classifier + format + mode-aware gate.
- [`app-state/menu-db-migrations/lint_test.go`](../app-state/menu-db-migrations/lint_test.go) — 15 sub-cases (table-driven lintFileBody, dir-scan, mode gate, real-fixture integration).
- [`app-state/menu-db-migrations/main.go`](../app-state/menu-db-migrations/main.go) — wires `gateMigrations` at the top of `run()`, before SSH.
- [`products/menu/drizzle/0001_drop_better_auth_tables.sql`](../products/menu/drizzle/0001_drop_better_auth_tables.sql) — retroactive markers.

## Rule 4 — hot-swap deploy

### Today
- `deploy/iedora/runtime_docker.go::dockerOnHetzner.Deploy`
  does `docker stop && docker rm && docker run` via SSH-shelled
  commands. ~5s 502 window during every deploy (the failure-modes
  table acknowledges it).
- Caddy routes upstream by Docker network alias `infra-menu-web`.
  When the container is gone, Caddy returns 502 until the new one
  comes up.

### Target
- New deploy flow:
  1. Pull image (unchanged).
  2. Compute alias = `<container>-<short-sha>`.
  3. Start new container with two aliases on the `iedora` network:
     `<container>-next` (fixed handle) AND `<alias>` (the sha-tagged
     one). NOT `infra-menu-web` yet.
  4. Go-native HTTP probe `http://<box>/up` via SSH-tunneled curl OR
     `docker exec <container> wget -qO- localhost:3000/up` until
     200 OK or timeout.
  5. Atomically swap: `docker network disconnect iedora <old>`
     followed by `docker network connect --alias infra-menu-web
     iedora <new>`. The alias swap is the cutover instant.
  6. Drain (configurable; default 10s) then
     `docker stop <old> && docker rm <old>`.
- On probe timeout: leave the old container running, tear down the
  new one, surface a clear error.

### Trade-offs to decide
- **Probe path**: docker-exec'd `wget` is simpler, no Caddy reload
  needed. SSH-tunneled `curl` from the operator side proves the
  request travels the same network path Caddy does. Pick docker-exec
  for v1; revisit if false-positives appear.
- **Alias swap vs Caddy reload**: alias swap is faster (no Caddy
  config change), but Caddy caches upstream DNS within the network.
  Test: does Caddy honor live alias re-resolution? If not, fallback
  to Caddy reload via `docker exec infra-caddy caddy reload`.

### Migration steps
1. Add `Healthcheck` field to the `dockerOnHetzner` struct: `Path`
   string (e.g. `/up`), `Port` int (e.g. 3000), `Timeout`,
   `Interval`.
2. Rewrite `Deploy` along the hot-swap flow above.
3. Add `deploy/iedora/runtime_docker_swap_test.go` with table-
   driven tests for the probe-then-swap state machine using a fake
   SSH executor.
4. Update `### Failure modes` row "`menu.iedora.com` 502 between
   deploys" — should no longer fire.
5. Manual validation: `task deploy:menu` × 5, monitor
   `menu.iedora.com/up` in a loop with `--max-time 1` from a
   second terminal. Expect zero non-200s.

### Files
- `deploy/iedora/runtime_docker.go` (rewrite Deploy)
- `deploy/iedora/runtime_docker_swap_test.go` (new)
- `deploy/iedora/products.go` (add Healthcheck to menu)
- `docs/deploy.md` (§ dockerOnHetzner — drop the ⚠️, update flow)

## Rule 5 — Zitadel anti-panic lock ✅ landed

### What landed

The audit found exactly **two** branches in `reconcile.go` that could
silently `delete + recreate` a live IAM resource on a "BWS key missing"
signal:

| Branch | Resource | Blast radius |
|--------|----------|--------------|
| `reconcile.go::reconcilePAT` | PAT `menu-sa` access token | 🔴 critical — menu container loses Zitadel auth, every user logged out until new PAT lands in BWS + container restarts |
| `reconcile.go::reconcileOneTarget` | Action target (`menu-permissions`, `menu-grants`) | 🔴 high — ~1s webhook gap until `reconcileExecutions` rebinds; stale scope claims during the window |

Everything else in the 949-line reconciler is create-only on miss
(project, project-roles, machine-user, OIDC app, OIDC client_secret
which uses Zitadel's `regenerate` endpoint, not delete) or idempotent
POSTs (IAM owner grant, action executions, admin grants).

### How it's gated

`guardRecreate(cfg, resource, bwsKey, descriptor)` in `reconcile.go`:
- Local mode → returns `nil`, recreate proceeds. (Local IS supposed
  to mint fresh on cold boot.)
- Live mode + `cfg.AllowRecreate[resource]` true → returns `nil`,
  recreate proceeds. (Operator-authorised destructive recovery.)
- Live mode without opt-in → returns a structured error naming the
  missing BWS key, the live resource ID, and the exact
  `--allow-recreate=<resource>` token to use.

Operator flag: `--allow-recreate=pat,target:menu-permissions` (comma-
separated, parsed by `parseAllowRecreate`). No `all` token — opt-in
is one resource at a time.

### Files

- [`app-state/zitadel/reconcile.go`](../app-state/zitadel/reconcile.go) — `Config.AllowRecreate` + `guardRecreate` helper + gates at the PAT and target delete branches.
- [`app-state/zitadel/main.go`](../app-state/zitadel/main.go) — `--allow-recreate` flag + `parseAllowRecreate` (comma-separated → `map[string]bool`).
- [`app-state/zitadel/reconcile_test.go`](../app-state/zitadel/reconcile_test.go) — table-driven tests for `guardRecreate` (7 cases covering local short-circuit, live strict, live with matching/wrong opt-in) + `parseAllowRecreate` (7 cases for split/trim/dedupe/empty).
- [`docs/deploy.md` § Environment guardrails — Rule 5](./deploy.md#5-zitadel-reconciler--anti-panic-lock) — operator-facing copy.
