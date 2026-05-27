# CI pipeline

What runs, when, and why. The `.github/workflows/` directory is the source of truth — this doc is the map.

## Principles

| Principle | Detail |
|---|---|
| **Quality gates run on PR, not on push to main.** | Main is PR-only protected. A `push: main` run after the merge is a duplicate of the PR run that already produced the same signal on the same SHA — pure waste. |
| **`merge_group` is wired everywhere.** | Forward-compat for GitHub Merge Queue. Required checks must fire on the queue's transient commit, otherwise the queue can't merge. Zero cost when no queue is enabled. |
| **`push: main` is reserved for artefact / per-ref signal producers.** | Image builds, `tofu apply`, CodeQL baselines indexed by ref. These produce something the PR run can't — keep them. |
| **`pull_request.types: [opened, synchronize, reopened]`** | Skips noise events (`labeled`, `edited`, `closed`) that don't change code. |
| **Paths are tight, runtime-aware.** | E2E only fires for packages the running shell actually loads. `packages/eslint-config` is lint-only — it does NOT trigger E2E. |
| **No staging tier.** | Stage 4 verification is an HTTP `/up` probe, never Playwright against production. See [`../deploy/README.md`](../deploy/README.md). |

## Trigger matrix

Legend: ✅ = fires, — = never, ◯ = on the listed condition.

| Workflow | `pull_request` | `merge_group` | `push: main` | `workflow_dispatch` | `schedule` | `workflow_call` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Quality gates** | | | | | | |
| `[e2e] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[product:menu] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[product:core] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[product:imopush] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[package:auth] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[package:design-system] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[package:observability] CI` | ✅ | ✅ | — | ✅ | — | — |
| `[infra] Topology drift` | ✅ | ✅ | — | — | — | — |
| `[security] Dependency review` | ✅ | — | — | — | — | — |
| **Artefact / per-ref signal** | | | | | | |
| `[apps:web] CI` | ✅ | — | ✅ | — | — | — |
| `[infra] DB migrator image` | ✅ | ✅ | ✅ | ✅ | — | — |
| `[infra] Deploy` | — | — | ✅ ◯ (via `workflow_run`) | — | — | — |
| `[infra] App state` | — | — | — | ✅ ◯ (chained from web.yml) | — | — |
| **Security baselines** | | | | | | |
| `[security] CodeQL` | ✅ | — | ✅ | — | ✅ Mon 04:30 UTC | — |
| `[security] Workflow policy` | ✅ | ✅ | ✅ ◯ (admin override safety) | — | — | — |
| **Library** | | | | | | |
| `[deploy] product` | — | — | — | — | — | ✅ (called by web.yml) |

> Every "Quality gate" row also accepts `workflow_dispatch` as a manual re-trigger (`gh workflow run <name> --ref <branch>`).

## Trigger flow

### PR lifecycle

```
 author pushes branch
        │
        ▼
 ┌────────────────────────┐
 │ open PR against main   │
 └────────────────────────┘
        │
        ├──► pull_request:opened   ──► fires every gate whose
        │                              paths match the diff
        ├──► pull_request:synchronize (every subsequent push)
        ├──► pull_request:reopened
        └─── pull_request:labeled / edited / closed   IGNORED

 gates run in parallel:
   ┌─ typecheck / lint / unit per product
   ├─ e2e (one build, --project=<changed-products>, see e2e-architecture.md)
   ├─ codeql, dependency-review
   └─ topology drift, workflow policy (if applicable)

 every gate passes  ──►  PR mergeable

 merge button clicked
        │
        ▼
 ┌────────────────────────┐
 │ optional: merge queue  │  if enabled, each queued PR is rebased
 │                        │  onto its predecessor and gets a
 │                        │  merge_group event → required gates
 │                        │  re-run against the queue commit
 └────────────────────────┘
        │
        ▼
   commit landed on main
```

### Main lifecycle (post-merge)

```
 commit on main
        │
        ├──► [apps:web] CI                        push: main
        │      ├─ typecheck / lint / security
        │      ├─ build + push image (ghcr.io/eduvhc/web:<sha>)
        │      ├─ run_app_state   ──► dispatches [infra] App state
        │      └─ deploy          ──► calls [deploy] product (workflow_call)
        │
        ├──► [infra] DB migrator image            push: main
        │      └─ build + push ghcr.io/eduvhc/migrate:<sha>
        │
        ├──► [infra] Deploy                       push: main
        │      └─ applies tofu state changes (infra/iac/**)
        │
        ├──► [security] CodeQL                    push: main
        │      └─ uploads baseline indexed by ref
        │
        └──► [security] Workflow policy           push: main
               └─ catches admin-override edits via web UI
```

### What does NOT run on `push: main`

Every quality gate. Once `main` is PR-only protected, the gate already produced its signal on the PR's HEAD SHA — running it again on the merge commit (same SHA, same code) is duplicate work.

## Why each kept `push: main`

| Workflow | Why `push: main` is retained |
|---|---|
| `web.yml` | Builds and pushes `ghcr.io/eduvhc/web:<sha>` and the `:latest` tag. The PR run doesn't promote `:latest` — only main does. Cascades into `app-state` + `deploy`. |
| `migrate.yml` | Builds and pushes `ghcr.io/eduvhc/migrate:<sha>`. Same reasoning as `web.yml`. |
| `infra-deploy.yml` | Runs `tofu apply` against the encrypted state. Only main is authorised to mutate live infra. |
| `codeql.yml` | Security findings are uploaded to the Code Scanning tab indexed by ref. The main-ref baseline is what GitHub uses for "default branch" comparisons. Cron run on Mondays gives weekly drift detection regardless of code churn. |
| `workflow-lint.yml` | Defence-in-depth — admin-override edits via the GitHub web UI bypass the PR flow. Cheap (~30s) so the duplicate run is acceptable insurance. |
| `migrate.yml` PR build | Tags the image with the PR head SHA. Allows deploy testing against a non-main build if needed. |

## Path filters

Tight paths are the second efficiency lever after dropping `push: main`. Each workflow lists only files whose change can affect its job.

### `e2e.yml` paths (canonical example)

Runs whenever the deployed binary's behaviour can change:

```yaml
- 'apps/web/**'                              # the shell
- 'products/**'                              # every product slice
- 'packages/auth/**'                         # runtime: better-auth
- 'packages/brand/**'                        # runtime: URL helpers
- 'packages/db/**'                           # runtime: schema
- 'packages/design-system/**'                # runtime: UI primitives
- 'packages/iedora-observability/**'         # runtime: OTel
- 'packages/product-core/**'                 # runtime: core routes
- 'bun.lock'                                 # any dep version bump
- '.github/workflows/e2e.yml'                # changes to the workflow itself
- '.github/actions/setup/**'                 # the install step's contract
```

Notably **excludes**:
- `packages/eslint-config/**` — lint rules don't affect runtime.
- `docs/**`, `**/*.md` — docs PRs don't run E2E (rely on workflow-lint + reviewer eyes).
- `infra/**` — infra changes never affect app behaviour pre-merge; the deploy lifecycle covers them.

### Product workflows (e.g. `product-menu.yml`)

```yaml
- 'products/menu/**'                         # this product's source
- 'packages/eslint-config/**'                # lint contract
- '.github/workflows/product-menu.yml'
- '.github/actions/setup/**'
```

Each product's CI is independent; `packages/eslint-config` is included here because lint runs in this workflow.

## How to add a new workflow

Decide which class it belongs to.

### Class A — Quality gate

A check that must pass before a PR merges and produces no artefact:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]
    paths:
      - '<the files this gate cares about>'
      - '.github/workflows/<your>.yml'
      - '.github/actions/setup/**'   # if it uses the setup action
  merge_group:
  workflow_dispatch:
```

### Class B — Artefact producer

A workflow that builds + pushes an image, mutates infra, or uploads a per-ref baseline:

```yaml
on:
  push:
    branches: [main]
    paths: [...]
  pull_request:                       # so PRs validate the build
    types: [opened, synchronize, reopened]
    branches: [main]
    paths: [...]
  merge_group:                        # required if it's also a required check
  workflow_dispatch:
```

### Class C — Library (called by other workflows)

```yaml
on:
  workflow_call:
    inputs:
      ...
```

No `pull_request` / `push`. Callers gate it.

## Adding a required check

When making a new gate required in branch protection:

1. Ensure the workflow has both `pull_request` AND `merge_group` triggers.
2. Add it to the required-status-checks list in branch protection settings.
3. **Match the job name exactly** — protection checks job names, not workflow names. `e2e.yml`'s required check is `Run (1/1)` (the matrix shard label), not `E2E (Playwright)`.
4. If using a job matrix, every matrix permutation becomes its own required check.

## Concurrency

Every workflow declares a `concurrency` group keyed by `${{ github.workflow }}-${{ github.ref }}`. Two pushes to the same PR cancel the in-flight run (saves minutes). The exceptions are state-mutating workflows:

- `infra-deploy` (`cancel-in-progress: false`) — partial `tofu apply` leaves state half-written.
- `deploy` (`cancel-in-progress: false` per product) — `docker stop` on a half-replaced container is the worst-of-both-worlds state.
- `app-state` (`cancel-in-progress: false`) — schema migrations are not interruptible.

## Action versions

Pinned at the latest stable major (May 2026):

| Action | Version | Note |
|---|---|---|
| `actions/checkout` | v6 | Node 24 |
| `actions/upload-artifact` | v7 | Non-zipped artefact support |
| `actions/cache` | v5 | Cache v2 backend |
| `actions/setup-go` | v6 | Node 24 |
| `actions/dependency-review-action` | v5 | |
| `actions/attest` | v4 | SLSA provenance |
| `oven-sh/setup-bun` | v2 | floats on v2.x (latest v2.2.0) |
| `docker/setup-buildx-action` | v4 | Node 24 |
| `docker/build-push-action` | v7 | |
| `github/codeql-action` | v4 | |
| `aquasecurity/trivy-action` | v0.36.0 | container SBOM scan |
| `opentofu/setup-opentofu` | v2 | |

Renovate keeps these moving forward; bumps land via PR like everything else.

## See also

- [`../testing/e2e-architecture.md`](../testing/e2e-architecture.md) — what `e2e.yml` actually runs.
- [`../deploy/README.md`](../deploy/README.md) — what `web.yml` / `deploy.yml` / `infra-deploy.yml` do post-merge.
- [`../tech-debt.md`](../tech-debt.md) — the `DOCKER-2` split between web and migrate images.
