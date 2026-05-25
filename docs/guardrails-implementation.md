# Guardrails — implementation plan

> Companion to [deploy.md § Environment guardrails](./deploy.md#environment-guardrails).
> The guardrails doc says **what** the rules are. This doc says **how**
> we get there from today's code. One section per rule; each ends with
> a concrete, ordered task list and the files that change.
>
> Order of recommended landing: ~~Rule 5 → Rule 1~~ → Rule 2 → Rule 3 → Rule 4.
> Rules 1 and 5 landed first (commits `ab72194` and the Rule 5 commit
> referenced below). Rule 2 is next — the bootstrap-heavy one that
> frees us from the encrypted-state-in-git pattern. 3 and 4 are then
> independent.

## Status at a glance

| Rule | Title                              | Status      | Effort | Blast radius |
|------|------------------------------------|-------------|--------|--------------|
| 1    | Binary environment (`local`/`live`)| ✅ landed   | —      | done in `ab72194` |
| 5    | Zitadel anti-panic lock            | ✅ landed   | —      | done — see this doc § Rule 5 |
| 2    | Tofu state in R2                   | Not started | L      | High — touches every apply, bootstrap problem |
| 3    | Expand-contract migrations         | Not started | M      | Medium — process + lint |
| 4    | Zero-downtime hot-swap             | Not started | M      | Medium — `runtime_docker.go` rewrite |

## Rule 1 — binary environment ✅ landed (`ab72194`)

Single source of truth: [`infra/internal/mode`](../infra/internal/mode/) —
`Mode` enum (`Local | Live`), `Resolve` / `MustResolve` / `Require`
(panics on mismatch) / `IsLive` / `IsLocal`. Adopted across all 5
binaries:

- `cmd/iedora` — pinned to `Live`, with `Require(Live)` at the top of
  every destructive entry point (`runIacApply`, `runIacDestroy`,
  `runAppApply`, `runDeployProduct`, `runDestroyProduct`).
- `cmd/dev` — pinned to `Local`.
- `cmd/zitadel-apply` — the only dual-mode binary; takes `--mode
  live|local` (default `live`). Mode plumbs through `loadConfig`,
  `buildStore` (live → `bwsStore`, local → `memoryStore`), `ensureSAKey`,
  and `waitForMenuDNS` (local short-circuits).
- `cmd/menu-db-migrations`, `cmd/openobserve-dashboards` — live-only
  by deployment topology; `const runsIn = mode.Live` documents it.

No back-compat surface — fresh ecosystem, no callers needed a
deprecation window.

## Rule 2 — Tofu state in R2

### Today
- `infra/tofu/terraform.tfstate` is git-tracked, encrypted with
  PBKDF2 + AES-GCM via the `encryption {}` block in `versions.tf`.
- CI workflows (`infra-deploy.yml`, `deploy.yml`) commit state back
  to `main` after every apply.
- Two state files in repo: `infra/tofu/terraform.tfstate` +
  `products/house/infra/tofu/terraform.tfstate`.

### Target
- OpenTofu `s3` backend pointed at the `iedora-tofu-state` R2 bucket.
  Native locking via R2 (DynamoDB-style lock table not supported by
  R2 → use Tofu's [`use_lockfile = true`](https://opentofu.org/docs/language/settings/backends/s3/#s3-state-locking)).
- State file gone from git; both state files `git rm --cached`'d and
  added to `.gitignore`.
- Bootstrap: a one-shot `infra/cmd/state-bucket-bootstrap/` Go binary
  creates the R2 bucket + scoped API token + writes the credentials
  to BWS under `IAC_BOOTSTRAP_TOFU_STATE_*`. Run once per fresh
  ecosystem. After that, `tofu init` consumes those credentials.
- `task infra:up` first-run flow: `tofu init -migrate-state` (move
  the in-repo encrypted file → R2). After that, no migrate flag.
- The `encryption {}` block stays — R2 sees encrypted bytes, never
  plaintext.

### The bootstrap problem
We can't manage the state bucket with Tofu and also keep state in it
— chicken-and-egg. Three options:

| Option | Approach | Trade-off |
|--------|----------|-----------|
| A | One-shot Go bootstrap binary creates bucket + token via CF API, writes to BWS. Bucket lives outside Tofu state. | Cleanest. Mirrors `bws-upsert`'s shape. One-time op. |
| B | Bucket managed by a tiny separate Tofu root (`infra/tofu-bootstrap/`) whose own state stays in git. | Two Tofu roots forever; the bootstrap one's state has to stay encrypted-in-git, which is the pattern we're escaping. Reject. |
| C | Manual CF dashboard creation. | Operator step we want to eliminate. Reject. |

**Pick A.**

### Migration steps
1. Write `infra/cmd/state-bucket-bootstrap/` — creates
   `iedora-tofu-state` R2 bucket, mints a scoped API token, writes
   `IAC_BOOTSTRAP_TOFU_STATE_ACCESS_KEY` +
   `IAC_BOOTSTRAP_TOFU_STATE_SECRET_KEY` to BWS. Idempotent.
2. Add to `bin/with-secrets --stage iac` env: `AWS_ACCESS_KEY_ID`
   and `AWS_SECRET_ACCESS_KEY` mapped from the BWS keys above.
3. Add the `backend "s3"` block to `infra/tofu/versions.tf` with
   `endpoints.s3 = "https://<acct>.r2.cloudflarestorage.com"`,
   `region = "auto"`, `skip_credentials_validation = true`,
   `skip_metadata_api_check = true`, `use_path_style = true`,
   `use_lockfile = true`.
4. Operator runs once: `bin/with-secrets --stage iac --
   tofu -chdir=infra/tofu init -migrate-state` — moves the
   in-repo state into R2.
5. `git rm --cached infra/tofu/terraform.tfstate
   products/house/infra/tofu/terraform.tfstate` and add both to
   `.gitignore`.
6. Drop the "commit tfstate back to main" steps from
   `.github/workflows/infra-deploy.yml` and
   `.github/workflows/deploy.yml`.
7. Drop the now-obsolete `### Encrypted state` section in
   `deploy.md`; replace with a `### State backend (R2)` section.
8. Repeat for `products/house/infra/tofu/` — second `backend "s3"`
   block, different key in the same bucket.

### Files
- `infra/cmd/state-bucket-bootstrap/main.go` (new)
- `infra/internal/r2/bootstrap.go` (helper: create bucket + token)
- `infra/cmd/with-secrets/env.go` (map state creds → AWS_* env)
- `infra/tofu/versions.tf` (add backend)
- `products/house/infra/tofu/versions.tf` (add backend)
- `infra/tofu/terraform.tfstate` (delete from index)
- `products/house/infra/tofu/terraform.tfstate` (delete from index)
- `.gitignore` (re-add the rules I added earlier in this session)
- `.github/workflows/infra-deploy.yml` (drop state commit-back)
- `.github/workflows/deploy.yml` (drop state commit-back)
- `docs/deploy.md` (rewrite § Encrypted state)
- `infra/CLAUDE.md` (drop the "state encrypted in git" claim)

## Rule 3 — expand-contract migrations

### Today
- `menu-db-migrations` runs drizzle-kit migrate unconditionally
  against the existing schema. Whatever's in
  `products/menu/drizzle/migrations/` gets applied.
- No lint. No expand/contract awareness. No way to flag a
  destructive op before it lands.

### Target
- A pre-migrate SQL linter inside `menu-db-migrations` scans the
  pending migration files for destructive operations:
  `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... TYPE` on a
  non-empty column, `RENAME COLUMN`, `RENAME TABLE`.
- In `live` mode, destructive ops without a matching
  `-- iedora:expand-contract phase=contract` marker fail the
  configurator.
- Marker forces the operator to annotate which phase a destructive
  migration is in. `phase=expand` (additive), `phase=migrate-data`
  (data backfill), `phase=contract` (drop the old). The contract
  phase is the only one that allows a destructive SQL statement,
  and it must reference the deploy N tag where the expand landed
  (e.g. `references=2026-06-01-add-foo-column`).
- A registry file `products/menu/drizzle/expand-contract.yaml`
  tracks open expand/contract pairs so the linter can verify the
  contract is at least one deploy after the expand.

### Migration steps
1. Add `infra/cmd/menu-db-migrations/lint.go` — a Go-native SQL
   tokenizer (or just regex; this is internal, not a parser
   contract) that scans the migration files.
2. Add the `-- iedora:` marker convention.
3. Add `products/menu/drizzle/expand-contract.yaml` registry +
   parser.
4. Wire `live` mode to fail on unannotated destructives;
   `local` mode warns only.
5. Document in `docs/deploy.md` § Stage 3 with an example.

### Files
- `infra/cmd/menu-db-migrations/lint.go` (new)
- `infra/cmd/menu-db-migrations/lint_test.go` (new — table-driven)
- `infra/cmd/menu-db-migrations/main.go` (wire lint)
- `products/menu/drizzle/expand-contract.yaml` (new — empty
  registry to start)
- `docs/deploy.md` (§ Stage 3 example)

## Rule 4 — hot-swap deploy

### Today
- `infra/cmd/iedora/runtime_docker.go::dockerOnHetzner.Deploy`
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
3. Add `infra/cmd/iedora/runtime_docker_swap_test.go` with table-
   driven tests for the probe-then-swap state machine using a fake
   SSH executor.
4. Update `### Failure modes` row "`menu.iedora.com` 502 between
   deploys" — should no longer fire.
5. Manual validation: `task deploy:menu` × 5, monitor
   `menu.iedora.com/up` in a loop with `--max-time 1` from a
   second terminal. Expect zero non-200s.

### Files
- `infra/cmd/iedora/runtime_docker.go` (rewrite Deploy)
- `infra/cmd/iedora/runtime_docker_swap_test.go` (new)
- `infra/cmd/iedora/products.go` (add Healthcheck to menu)
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

- [`infra/cmd/zitadel-apply/reconcile.go`](../infra/cmd/zitadel-apply/reconcile.go) — `Config.AllowRecreate` + `guardRecreate` helper + gates at the PAT and target delete branches.
- [`infra/cmd/zitadel-apply/main.go`](../infra/cmd/zitadel-apply/main.go) — `--allow-recreate` flag + `parseAllowRecreate` (comma-separated → `map[string]bool`).
- [`infra/cmd/zitadel-apply/reconcile_test.go`](../infra/cmd/zitadel-apply/reconcile_test.go) — table-driven tests for `guardRecreate` (7 cases covering local short-circuit, live strict, live with matching/wrong opt-in) + `parseAllowRecreate` (7 cases for split/trim/dedupe/empty).
- [`docs/deploy.md` § Environment guardrails — Rule 5](./deploy.md#5-zitadel-reconciler--anti-panic-lock) — operator-facing copy.
