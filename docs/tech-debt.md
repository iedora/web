# Tech debt queue

Real cleanup items — things that work but could be more idiomatic /
less repetitive / more aligned with industry standards. None of these
are bugs; none block product work. Order is rough priority.

Tag legend:
- **size:** S (< 1h), M (< 1 day), L (multi-day)
- **risk:** low / med / high (chance of breaking something during cleanup)

---

## CI / GitHub Actions

### CI-1: BWS install + GHCR login boilerplate duplicated across workflows
**size:** S · **risk:** low

The 8-line "Install bws CLI" + 7-line "Log in to GHCR" patterns repeat
across `web.yml` + `infra-deploy.yml` (×2 jobs after consolidation) +
`deploy.yml` + `app-state.yml`. ~50 lines of repetition. Adding a new
workflow that needs BWS access copies the same snippets again.

Fix: composite actions at
- `.github/actions/install-bws/action.yml` (input: BWS_ACCESS_TOKEN)
- `.github/actions/ghcr-login/action.yml` (uses install-bws)

### CI-2: SSH key write boilerplate duplicated across 3 workflows
**size:** S · **risk:** low

The 7-line block that writes `IAC_BOOTSTRAP_SSH_PRIVATE_KEY` to
`~/.ssh/id_ed25519` + adds the agent appears in `infra-deploy.yml`,
`app-state.yml`, `deploy.yml`. Same fix as CI-1: composite action.

### CI-3: web.yml has 76 lines of inline shell in `run:` blocks
**size:** M · **risk:** low

Polling loops + bws-fetch + multi-step build orchestration grew
inline. Extract to `.github/scripts/wait-app-state.sh` or composite
actions. `app-state.yml`, `deploy.yml`, `infra-deploy.yml` have
similar but smaller blocks (30-40 each).

### CI-5: workflows over-trigger on irrelevant changes
**size:** S · **risk:** low

Two distinct over-triggering issues observed in practice:

**(a) `[security] CodeQL`** runs on every push to main except for the
narrow `paths-ignore` list (`*.md`, `docs/**`, `LICENSE*`,
`.gitignore`, `.editorconfig`). That means it fires on:
- Any workflow file edit (`.github/workflows/*.yml`) — no source code
  scanned, but a full 20-min SAST runs anyway.
- Tofu HCL changes (`infra/iac/tofu/**`) — no JS/TS to scan.
- Go-only changes (`infra/**/*.go`, `internal/**`) — JS/TS analyzer
  doesn't apply.
- Config-only changes (`vitest.config.ts`, `drizzle.config.ts`, etc.)
  — touches no business code.

Fix: switch from `paths-ignore` (denylist) to `paths` (allowlist),
listing only paths that contain JS/TS source:
```yaml
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.mts'
  - '**/*.js'
  - '**/*.mjs'
  - '**/*.cjs'
  - 'bun.lock'
  - 'package.json'
```
Weekly cron still catches anything missed.

Previous reasoning (in codeql.yml header comment): "SAST signal lives
in cross-cutting taint flow — a vuln in a shared package can surface
only when reached from a product's entrypoint". Valid argument, but
the same logic doesn't apply when ZERO JS/TS files change — there's
nothing new to taint-flow into.

**Required before landing the optimization — security coverage audit:**
Confirm that EVERY security-relevant path is still scanned by SOMETHING
on every change to it. Coverage matrix to verify:

| Path | What scans it today | Still scanned after CI-5? |
|---|---|---|
| `apps/web/**`, `products/**`, `packages/**` | CodeQL (push+PR) + Trivy in web.yml | YES (paths allowlist matches) |
| `bun.lock` | dependency-review (PR) + Trivy (every web.yml run) | YES (allowlisted) |
| `infra/**` Go code | nothing today (CodeQL JS/TS-only) | NO CHANGE — gap exists, not new |
| Tofu HCL `infra/iac/tofu/**` | nothing | NO CHANGE — out of CodeQL scope |
| `.github/workflows/**` | nothing (actionlint local, not CI) | NO CHANGE — separate issue (SEC-2 below) |

The audit IS the gate — don't land CI-5 without confirming each row
above is acceptable. Add a SEC-1 ticket for Go code SAST coverage if
desired (CodeQL `go` analyzer or staticcheck).

### SEC-1: Go code has no SAST coverage
**size:** M · **risk:** low

Stage-3/4 orchestrator (`infra/deploy/cmd/iedora/`, `infra/iac/cmd/`,
`internal/`) is ~3k LOC of Go that handles SSH, BWS tokens, postgres
URLs, and `docker run`-shaped command-building. CodeQL today runs
only the `javascript-typescript` analyzer; no Go scan.

If/when this matters: add `go` to the codeql.yml language matrix and
`security-extended` queries cover Go too. Bigger CI cost (~10 extra
min/run); justified if the Go surface grows or starts handling
untrusted input.

### SEC-2: GitHub Actions workflows have no policy scan
**size:** S · **risk:** low

`actionlint` runs LOCALLY (used during this session) but isn't in CI.
Workflows can drift into anti-patterns: missing `permissions:`
declarations, untrusted `pull_request_target` inputs interpolated
into shell, deprecated runners, supply-chain risks from unpinned
actions (now using tag refs — see tech-debt note on CI elsewhere).

Fix: add a workflow that runs `actionlint` + optionally
`pinact`/`zizmor` on every PR + push that touches
`.github/workflows/**`. ~5 min CI cost, blocks bad practice early.

**(b) Per-product / per-package CIs include `bun.lock` + `package.json`
in their paths.** Any dep update (e.g. bumping a dev dep at the
workspace root) triggers EVERY product + package CI to re-run, even
when their own code is untouched. Bun workspaces hoist deps to the
root, so a `bun.lock` diff often touches every workspace's effective
deps — but the per-product CI is meant to gate the product's own
typecheck + lint + test, not whether any of its transitive deps
changed.

Fix: drop `bun.lock` + `package.json` from the per-workspace paths
filters. A workspace-root `[deps] CI` workflow (TBD — could just be
`bun install --frozen-lockfile` + smoke-typecheck of every workspace)
would handle the "dep change broke something" case once.

### CI-4: ~~cross-workflow gating via `gh run list` polling~~ → resolved
**size:** ~~L~~ · **risk:** ~~med~~

Original problem: `web.yml::wait_app_state` polled the LATEST
`app-state.yml` run on main — which could be a totally different
commit's run (often cancelled or stale). Caused Day-1 to fail with
"app-state.yml cancelled — refusing to deploy" even when infra was
fine.

Resolved by switching `web.yml::run_app_state` to a **dispatch +
follow-by-run-id** pattern: snapshot the latest app-state run, run
`gh workflow run app-state.yml`, poll until a new run appears, then
poll THAT specific run-id for completion. Deterministic — no
ambiguity about which run gates the deploy.

Side change: dropped the `workflow_run` cascade trigger on
`app-state.yml` (it was unreliable in practice — fired ~half the
time, possibly due to GHA's "workflow file must be on default
branch" race during rapid commits).

---

## TypeScript / monorepo

### TS-1: Composite TS project references only on `products/menu`
**size:** M · **risk:** med

`products/menu` is the only workspace using `composite: true` +
`emitDeclarationOnly: true` because it was the only one with internal
`@/` paths (now removed, but composite is the proper monorepo
shape regardless). Other workspaces (packages/auth, packages/db,
products/core, etc.) still use plain `tsc --noEmit`.

Going composite for all: each workspace gets `tsconfig.json` with
composite settings + apps/web declares full `references:` list.
Benefits: incremental + cached typecheck, true .d.ts boundaries.
Cost: per-workspace `dist/`, more moving pieces.

Defer unless typecheck speed becomes a real annoyance.

### TS-2: Per-workspace script naming inconsistency
**size:** S · **risk:** low

Lint scripts: most workspaces use `eslint src` but `products/menu`
and `apps/web` just use `eslint` (which picks up scope from
`eslint.config.mjs`). Functionally identical, just style drift.

Test scripts: mix of `vitest run` and `vitest run --passWithNoTests`.
The `--passWithNoTests` flag is correct for workspaces that don't
have tests yet — but ideally a CI-level convention (workflow checks
if test files exist before invoking).

### TS-3: No root-level orchestrator scripts
**size:** S · **risk:** low

`package.json` at root has an empty `"scripts": {}`. Want to typecheck
the whole monorepo? Loop per-workspace via shell. A root `typecheck`
script (or proper task runner like Turborepo / Nx / Bun's recent
task primitive) would centralize "run X across every workspace".

For now, CI has per-workspace jobs which serves the same goal.

### TS-4: drizzle-orm version pinned in 4 workspaces independently
**size:** S · **risk:** low

`packages/auth`, `packages/db`, `products/menu`, `products/imopush`
each declare `"drizzle-orm": "^0.45.2"`. If one drifts, weird type
mismatches. Bun's recent `catalog:` feature (or pnpm's catalog)
would let us declare the version once at workspace root and
reference it per-package.

---

## Code-level

### CODE-1: TODO in restaurant-identity actions
**size:** S · **risk:** low

`products/menu/src/features/restaurant-identity/actions.ts:78` has a
`TODO(language-switch-ui)` about surfacing a count to the UI. Real
product task, not architecture; tracked as code, not on a backlog.

---

## Anti-debt (things that LOOK like hacks but aren't, documented for clarity)

- **`apps/web/public/.gitkeep`** — canonical solution for tracking an
  empty directory (git can't track dirs natively). Standard, not a hack.
- **`*.tsbuildinfo` in `.gitignore`** — tsc incremental output;
  excluding from source control is correct.
- **`menu_database_url` / `menu_public_url` in Tofu outputs** —
  describe the resource (postgres DB named `menu`, URL
  `menu.iedora.com`), not the consumer. Renaming would be wrong.
- **Per-product `MENU_PUBLIC_URL` env var in web container** — the
  menu-subdomain URL is genuinely menu-specific even though it's
  read by the unified `web` container.
- **`products/menu/tsconfig.tests.json` non-composite** — tests +
  configs include files outside `src/` (drizzle.config, vitest.config,
  instrumentation.ts) that composite mode would refuse. Non-composite
  for tests is the right shape.
- **`MENU_IMAGE_SHA` → `IMAGE_SHA` env name** — already cleaned up.
  Carrying the rename across BWS keys would be next-level overkill
  (no consumer reads from BWS for this).
