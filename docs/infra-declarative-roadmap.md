# Infra declarative roadmap

> _Updated 2026-05-20: the Kamal-to-Tofu migration landed. Tier 1 (Tofu-managed GH config) and Tier 2 (shared tunnel module) are live. The "Imperative" inventory shrank substantially — the menu app container itself is now a `docker_container` resource, not a Kamal rollout target. Next phase: Tier 7 (Zitadel adapter — issue #19 Phase 3+)._

## Goal

Maximize the share of infra defined declaratively so an LLM can safely add a 4th product, rotate a credential, or change a network rule by editing one block instead of running a sequence of imperative commands. The user explicitly framed this as "leverage LLMs"; concretely that means:

- **One source of truth per resource.** No "set in BWS AND in `gh variable set`."
- **`for_each` over a `locals.products` map** wherever multiple products share a shape, so the marginal cost of a new product is a few lines in one place.
- **Validation blocks** at variable boundaries to catch bad LLM edits before they hit a provider API.
- **Idempotent surface.** Re-running `just infra::deploy` should converge; nothing should need a specific call order.

What we are NOT trying to do:

- Replace the CI workflow YAMLs with HCL (those are already declarative — moving them to HCL would be ceremony).
- Move to Terragrunt or Kubernetes (heavier than the gain).
- Eliminate state files (encrypted state in git is already the pattern; works).
- Eliminate `tofu apply` (the runtime step IS imperative; what we declare is the desired state).

---

## Inventory — what's declarative today vs. imperative

**Declarative (Tofu-managed):**

| Resource | Location | Notes |
|---|---|---|
| Hetzner CAX11 VPS + firewall + SSH key | `infra/tofu/hetzner.tf` | `hcloud` provider; one box, ARM64 |
| Cloudflare R2 buckets, scoped tokens, CORS | `products/menu/infra/tofu/`, `infra/tofu/` | Per-product roots + shared backups bucket |
| Cloudflare DNS for menu + auth (grey-cloud A records) | `infra/tofu/main.tf` | Direct to Hetzner IPv4; Caddy on-box terminates TLS |
| Cloudflare Tunnel + DNS for obs.iedora.com | `infra/tofu/main.tf` (`module.observability_tunnel`) | The only remaining tunnel — OpenObserve doesn't sit behind Caddy |
| Cloudflare workload token (wrangler) | `products/house/infra/tofu/` | Narrow scope; minted by Tofu, consumed by wrangler |
| Every Docker container on the box | `infra/tofu/containers.tf` | `kreuzwerker/docker` provider over SSH: postgres, backups, openobserve, openobserve-tunnel, zitadel, zitadel-login, caddy, **menu_web** |
| GitHub Actions secrets + variables | `infra/tofu/github.tf` | `integrations/github` provider; `for_each` over a locals map |
| Zitadel orgs + projects | `infra/tofu/zitadel.tf` | `zitadel/zitadel` provider; lands after the SA-key bootstrap |
| Docker images | `products/*/infra/Dockerfile` | Declarative Dockerfiles |
| CI workflows | `.github/workflows/*.yml` | Declarative YAML |

**Imperative (candidates for migration):**

| What | Where | Pain |
|---|---|---|
| BWS bootstrap secret population | `docs/deploy.md` instructs a `bws secret create` shell loop | Easy to miss a key; no source-of-truth for what BWS *should* contain |
| Per-product Tofu boilerplate | 2× duplicated `versions.tf` (32 lines each) + duplicated core variables | Adding a 3rd product = copy-paste-edit 3 files |
| Cloudflare account ID | Hardcoded in 3× `.env` files | One more thing to remember on new-laptop setup |
| 3× `bin/with-secrets` scripts | Per-product + shared infra | All compute the same TF_VAR_* aliases ± per-root variations |
| Hetzner VPS bootstrap of Zitadel SA key | 3-pass `just infra::deploy` dance — Pass 3 lifts FirstInstance's JSON key out of a Docker volume into BWS | Runs ONCE per Zitadel re-bootstrap; codified in `infra/justfile` but not pure-declarative |

**Inherently imperative (leave alone):**

- Container entrypoints (`infra/backup/{backup,restore,run}.sh`) — by definition imperative; they're the *thing being run*, not infra declaration.
- `tofu apply`, `kamal deploy`, `wrangler deploy` themselves — the *runtime step* is imperative; only the *configuration* is declarative.

---

## Findings from research

Background research agent verified the 2026 state of each candidate. Highlights below; full URL trail at the bottom of this doc.

**Mature providers, immediately adoptable.**

- **`integrations/github` v6.12.1** (Apr 2026) — fully covers `github_actions_secret`, `github_actions_variable`, `github_actions_environment_*`, `github_repository_ruleset` (the modern branch-protection successor). The 2026-canonical auth path is a **GitHub App** with scoped repo permissions (not a fine-grained PAT — fine-grained PATs are documented as second-class for several App-related resources). For solo + one-repo, a fine-grained PAT works today and the upgrade path to an App is mechanical.
- **`cloudflare/cloudflare` v5.14+** — GA since Feb 2025. The data sources `cloudflare_accounts` and `cloudflare_zone` (v5 syntax: `filter = { name = "..." }`) let us derive account + zone IDs from the bootstrap token alone; `.env` files lose `CLOUDFLARE_ACCOUNT_ID`.
- **`tailscale/tailscale` ~ 0.16/0.17** — beyond ACL + OAuth clients (already in use), exposes `tailscale_tailnet_key` (machine auth keys for headless onboarding), `tailscale_device_subnet_routes`, `tailscale_dns_*`, `tailscale_webhook`. Funnel is NOT yet provider-managed.

**Pre-GA, use with care.**

- **`bitwarden/bitwarden-secrets` v0.5.4-pre** (Sept 2024) — official Bitwarden provider for BWS. Exposes `bitwarden-secrets_secret` (create/read/update). Auth via `BW_ACCESS_TOKEN` + `organization_id`. **Has not seen a release in ~20 months and still carries `-pre`**; treat as bonus, not a critical-path dep. Worth using if the pre-GA risk is acceptable — the win is replacing the imperative `bws secret create` loop in `docs/deploy.md` with declarative resources, and letting Tofu generate the random-value secrets via `random_password` directly into BWS.

**Pragmatic call: skip, keep current shape.**

- **Workflows-as-HCL** — no traction. The closest thing is Terramate's `generate_file` primitive, and the 2026 consensus is "YAML is what every LLM has seen most of; keep it." Add `actionlint` as a CI lint step is the highest-value workflow-side improvement.
- **Terragrunt / Terramate** — overkill at 3-product scale. The shared `modules/` directory + per-product roots pattern (which is what we'd adopt for Tier 2) covers everything they offered. Revisit Terramate if we ever ladder to 8+ stacks (it shines on change-detection).
- **Atlantis / GitOps `tofu apply`** — overkill solo. The merge-time auto-apply pattern shines when there's a second human reviewing PRs; for solo dev, manual `just infra::deploy` is plenty.
- **Stateless / state-as-code** — there is no 2026 movement toward stateless Tofu. The encrypted-state-in-git pattern this repo already uses IS the solo-dev best practice; the only tweak worth making is pinning PBKDF2 to ≥600k iterations.
- **OS provisioning via Tofu provisioners** — explicitly deprecated. The 2026 pattern is cloud-init for cloud VPSes (`cloudinit_config` data source feeding Hetzner user-data), a one-shot bootstrap script for the homelab. Ansible is the textbook answer but out of proportion for one homelab + a couple of cloud nodes.

**LLM-friendly conventions worth codifying.**

The HashiCorp Claude-skill, Antón Babenko's terraform-skill, and two recent arXiv papers (TerraFormer + Deployability-Centric IaC Generation) converge on the same 10 bullets — a closed-loop `validate → plan → fix` is what moves LLM output from "syntactically plausible" to "deployable." Specific conventions land in `AGENTS.md` as part of this work (see `docs/terraform-style.md`).

Sources: `integrations/terraform-provider-github` releases / [#2103](https://github.com/integrations/terraform-provider-github/issues/2103) / [#3257](https://github.com/integrations/terraform-provider-github/issues/3257); Bitwarden Terraform Provider docs + `bitwarden/terraform-provider-bitwarden-secrets` releases; Scalr / Firefly / Terramate platform guides; Cloudflare v5 GA changelog (2025-02-03) + zone/accounts data source docs; Tailscale `tailscale_device_subnet_routes` + grants-vs-ACLs docs; OpenTofu state encryption docs; HashiCorp + Babenko terraform-skill repos; arXiv 2601.08734 + 2506.05623.

---

## Migration plan — ranked by value / risk

### Tier 1 · Tofu-managed GitHub repo config

**What:** Declare every GH Actions secret + variable in `infra/tofu/github.tf` via the `integrations/github` provider. `just infra::deploy` then reconciles GH repo state alongside Cloudflare + Tailscale.

**Why first:** The `gh secret set` × 6 commands in `docs/deploy.md` are the most LLM-unfriendly part of the current setup — they require running a specific sequence, can't be re-derived from any source of truth, and silently go stale (e.g. the leftover `BETTER_AUTH_SECRET` currently in the repo from an earlier flow).

**Shape (illustrative — full files in the implementation section below):**

```hcl
provider "github" {
  owner = "eduvhc"
  # Auth via GITHUB_TOKEN env var (fine-grained PAT or GH App token)
}

locals {
  github_repo = "iedora"

  # Variables — non-secret. Same source as bin/with-secrets resolves locally.
  github_variables = {
    BWS_PROJECT_ID         = var.bws_project_id            # ← .env / Tofu input
    ONPREM_HOST            = var.ci_onprem_host            # tailnet hostname
    MENU_PUBLIC_HOSTNAME   = "menu.iedora.com"
    GENKAN_PUBLIC_HOSTNAME = "genkan.iedora.com"
  }

  # Secrets — sourced from BWS via bws CLI in bin/with-secrets, fed in as
  # Tofu vars by the local recipe. Stays out of state in plaintext.
  github_secrets = {
    BWS_ACCESS_TOKEN      = var.bws_access_token
    KAMAL_SSH_PRIVATE_KEY = var.kamal_ssh_private_key
  }
}

resource "github_actions_variable" "vars" {
  for_each      = local.github_variables
  repository    = local.github_repo
  variable_name = each.key
  value         = each.value
}

resource "github_actions_secret" "secrets" {
  for_each        = local.github_secrets
  repository      = local.github_repo
  secret_name     = each.key
  plaintext_value = each.value
}
```

**What this buys:**

- Adding a new product = one line in `github_variables` (e.g. `NEWPROD_PUBLIC_HOSTNAME`).
- The leftover `BETTER_AUTH_SECRET` either gets imported and managed, or removed via `gh secret delete` (Tofu won't manage what it doesn't declare, but the audit becomes a one-liner: `tofu plan` shows extras as "outside Terraform's control").
- LLMs can safely refactor — `for_each` over a map is the canonical idiom.

**Risks:**

- Bootstrapping the `github` provider needs a GH PAT (chicken-and-egg, same shape as the Tailscale bootstrap). Lives in BWS as `INFRA_GITHUB_API_TOKEN` with scopes: `repo`, `actions:write`. Fine-grained PAT scoped to one repo is best.
- If the laptop loses Tofu state, the secrets in state are gone (the `plaintext_value` is in state but only at apply-time; Tofu never reads them back). Mitigated by BWS being the canonical source — `tofu apply` re-pushes from BWS values.

### Tier 2 · Per-product Tofu module for tunnel + DNS

**What:** Extract the ~50-line "tunnel + ingress + DNS" pattern duplicated across `products/menu/infra/tofu/menu.tf` and `products/genkan/infra/tofu/genkan.tf` into a `infra/modules/cloudflare-tunnel-app/` module. Each product's root collapses to a `module "tunnel" { source = "..."; ... }` call.

**Why second:** Adding a 4th product that needs a public hostname today = copy-paste 50 lines. With the module, it's a 5-line block. Pure win — the per-product Tofu *roots* stay independent (blast-radius isolation preserved, matching the existing `docs/deploy.md` rationale), but the *code inside them* gets DRY-ed up.

**Shape:**

```
infra/modules/cloudflare-tunnel-app/
├── main.tf         # tunnel + ingress + DNS — current shape, parameterized
├── variables.tf    # account_id, tunnel_name, public_hostname, ingress_extra (list)
└── outputs.tf      # tunnel_id, tunnel_token
```

```hcl
# products/menu/infra/tofu/menu.tf — after refactor (excerpt)
module "tunnel" {
  source = "../../../../infra/modules/cloudflare-tunnel-app"

  account_id      = var.account_id
  tunnel_name     = "menu"
  public_hostname = var.public_hostname
  # Extra ingress entries (none for menu beyond the default kamal-proxy)
  ingress_extra   = []
}

# Outputs that read from the module
output "tunnel_id"    { value = module.tunnel.id }
output "tunnel_token" { value = module.tunnel.token, sensitive = true }
```

**What this buys:**

- A schema change to the tunnel pattern lands in one place; menu + genkan inherit.
- A 4th product = `module "tunnel" { source = "..."; tunnel_name = "newprod"; public_hostname = "newprod.iedora.com"; ingress_extra = [] }` — that's the whole config.
- House stays unaffected (it doesn't need a tunnel — it's static on Workers).

**Risks:**

- Tofu module path versioning. Using `source = "../../../../infra/modules/..."` is fine for a monorepo (local path source); no registry needed.
- Existing state import: `tofu state mv` from the inline resources to the module-qualified addresses. Documented one-time op.

### Tier 3 · Declarative BWS schema — DEFERRED (pre-GA risk)

**Confirmed by research:** `bitwarden/bitwarden-secrets` exists and exposes `bitwarden-secrets_secret` resources. But the **last release was Sept 2024 (v0.5.4-pre)** — ~20 months stale and still pre-GA. Adopting it today means tying the bootstrap loop to a provider that may or may not see a future release.

**The win if we adopted it** (eliminate `bws secret create` × 9 in `deploy.md`):

```hcl
# Random-value secrets — Tofu generates + writes through, no human input.
resource "random_password" "infra_state_passphrase" { length = 48, special = false }
resource "bitwarden-secrets_secret" "infra_state_passphrase" {
  key   = "INFRA_STATE_PASSPHRASE"
  value = random_password.infra_state_passphrase.result
  # ... project_id, organization_id
}

# Existing flows that write through to BWS (Tailscale CI OAuth, house workers
# token) become direct resource references instead of imperative bws commands.

# User-provided values — TF_VAR_* exposes them once at apply.
resource "bitwarden-secrets_secret" "infra_cloudflare_api_token" {
  key   = "INFRA_CLOUDFLARE_API_TOKEN"
  value = var.cloudflare_api_token_bootstrap
}
```

**The reason it stays deferred:** ~6 random secrets are minted ONCE per laptop clone via `openssl rand -hex 32`. That bootstrap pain is rare. Trading it for a dependency on an apparently-stalled provider is the wrong trade until the provider sees fresh maintenance signal. Re-evaluate every 6 months; if Bitwarden ships v0.6+ this becomes Tier 1.

### Tier 4 · Cloudflare account derivation

**What:** Drop `CLOUDFLARE_ACCOUNT_ID` from all four `.env` files. Add `data "cloudflare_accounts" "me" {}` per root; resources reference `data.cloudflare_accounts.me.result[0].id`. Wrap with a precondition asserting `length(result) == 1` so a token with multi-account access fails loudly instead of silently picking the wrong one.

**Why fourth:** Small win — one less environment variable per product. But it touches every product root + the shared infra root, so it's a coordinated change (~5 file edits). The zone ID is already derived (`data.cloudflare_zone.this`). Net result: the bootstrap token IS the only Cloudflare credential a fresh laptop needs.

**Compat note (v5 regressions):** Cloudflare provider v5.0.x had a regression where `cloudflare_zone` data source claimed `zone_id` was required and another where its output couldn't be cleanly passed to `cloudflare_dns_record` (issues #4958, #5350). Both fixed in later 5.x. Pin to `~> 5.14` and don't blindly track latest.

### Tier 5 · Shared `with-secrets` script

**What:** Reduce the 4× `bin/with-secrets` files (each ~50 lines) to a single shared script + per-product wrapper. Each per-product wrapper would just `export PRODUCT=<name>` and call the shared one.

**Why fifth:** Pure DRY refactor. Saves ~150 lines of duplicated shell. No external state changes.

### Tier 6 (deferred) · GitOps for `tofu apply`

**What:** Auto-`tofu apply` on push to main (via Atlantis or plain GHA). Currently `just infra::deploy` is run from a laptop.

**Why deferred:** For a solo dev, the laptop-driven flow has fewer moving parts. GitOps shines when there's a team that needs change review; for a solo dev who already reviews their own diffs, it's added complexity. Revisit when team grows.

---

## What this enables for adding a 4th product

Today (4th product = copy 12 files, edit each, run 6 GH commands, run a `bws secret create` loop):

```
products/<newprod>/
├── package.json + src/...                  (Bun workspace boilerplate)
├── infra/
│   ├── .env.example
│   ├── bin/with-secrets                    (copy from sibling)
│   ├── justfile                            (copy + edit)
│   ├── Dockerfile                          (copy + edit)
│   ├── kamal/config/deploy.yml
│   ├── kamal/.kamal/secrets
│   └── tofu/
│       ├── versions.tf                     (copy verbatim — 32 dup lines)
│       ├── variables.tf                    (copy + edit defaults)
│       ├── <newprod>.tf                    (copy menu.tf, edit names)
│       └── outputs.tf
.github/workflows/<newprod>.yml             (copy + edit paths)
.github/workflows/<newprod>-deploy.yml      (copy + edit)
```

After Tier 1 + Tier 2 (4th product = copy 8 files, declare 1 line in `infra/tofu/github.tf`):

```
products/<newprod>/                          (same Bun workspace)
├── infra/
│   ├── .env.example                        (just BWS access + ACCOUNT_ID)
│   ├── justfile                            (5-recipe boilerplate, mostly forwarders)
│   ├── Dockerfile
│   ├── kamal/config/deploy.yml
│   └── tofu/
│       ├── versions.tf                     (still has to exist per root)
│       ├── variables.tf
│       └── <newprod>.tf                    ← module call, 5 lines
.github/workflows/<newprod>.yml             (CI — still per-product)
.github/workflows/<newprod>-deploy.yml      (reusable shim, 15 lines)

infra/tofu/github.tf                        ← 2 new lines in local.github_variables
```

Marginal cost drops from ~600 lines copied to ~80 lines new.

---

## What NOT to do

- **Don't merge the per-product Tofu roots.** The blast-radius isolation is documented as deliberate; merging them puts every product's resources in one state file. Modules give code reuse without that cost.
- **Don't generate `kamal/deploy.yml` from Tofu.** Both Kamal's YAML and Tofu's HCL are declarative; cross-translating between them only adds an indirection layer.
- **Don't move CI workflow YAMLs to HCL.** GH Actions' YAML is the canonical declarative form; the `actions-yaml-from-hcl` providers I've seen are toys.
- **Don't auto-apply Tofu from CI** (Tier 6). For a solo dev, manual `just infra::deploy` is plenty.
- **Don't introduce Terragrunt.** OpenTofu 1.10's native `encryption {}` + module sources cover everything Terragrunt offered; the maintenance cost isn't worth the marginal feature.

---

## Implementation status

Done overnight, NOT applied (nothing touches `tofu apply` / `gh secret set` / the homelab — you review and roll out when you're back):

### ✓ Tier 1 — Tofu-managed GitHub config

**Files added/modified:**
- `infra/tofu/versions.tf` — added `integrations/github ~> 6.12` provider
- `infra/tofu/variables.tf` — added `github_owner`, `github_repo`, `github_token`, `bws_access_token`, `bws_project_id`, `kamal_ssh_private_key`, `ci_onprem_host`, `menu_public_hostname`, `genkan_public_hostname` (with sensible defaults)
- `infra/tofu/github.tf` — **NEW** — `for_each` over `local.github_variables` + `local.github_secrets` maps
- `infra/bin/with-secrets` — exports the new `TF_VAR_*` aliases from BWS

**One-time bootstrap you'll need to do:**
1. Create a GitHub fine-grained PAT at `https://github.com/settings/personal-access-tokens?type=beta`. Scope: this repo only. Permissions: Actions (R/W), Secrets (R/W), Variables (R/W), Contents (R).
2. Add to BWS as `INFRA_GITHUB_API_TOKEN`.
3. Add your `ci_ed25519` private key (currently at `~/.ssh/ci_ed25519`) to BWS as `INFRA_KAMAL_SSH_PRIVATE_KEY` so Tofu can push it as the GH secret. `bws secret create INFRA_KAMAL_SSH_PRIVATE_KEY "$(cat ~/.ssh/ci_ed25519)" "$BWS_PROJECT_ID" -o none`.
4. (Recommended in 2026) Migrate to a GitHub App later instead of the PAT — the App auth path is more future-proof per `integrations/terraform-provider-github` #2103. Out of scope for tonight.

**After bootstrap, applying:**
1. Run `just infra::deploy` — Tofu reconciles GH Actions secrets + variables.
2. Verify with `gh secret list` and `gh variable list`.
3. Delete the leftover `BETTER_AUTH_SECRET` GH secret: `gh secret delete BETTER_AUTH_SECRET` (Tofu doesn't manage what it doesn't declare, but it's worth cleaning up).

### ✓ Tier 2 — Shared Tofu module for tunnel + DNS

**Files added (NOT yet wired into existing product roots — see migration step):**
- `infra/modules/cloudflare-tunnel-app/main.tf` — tunnel + ingress + DNS, parameterized
- `infra/modules/cloudflare-tunnel-app/variables.tf` — `account_id`, `zone_id`, `tunnel_name`, `public_hostname`, `extra_ingress` (list)
- `infra/modules/cloudflare-tunnel-app/outputs.tf` — `tunnel_id`, `tunnel_token`

**Migration step (you decide when):**
1. Read `products/menu/infra/tofu/menu.tf` — the tunnel + DNS section (lines ~37-82). Mentally replace with a `module "tunnel"` block referencing the new module.
2. `tofu state mv` each resource from `cloudflare_zero_trust_tunnel_cloudflared.menu` → `module.tunnel.cloudflare_zero_trust_tunnel_cloudflared.this`, etc. The module file documents the exact addresses.
3. `tofu plan` — should report zero changes (state moved, not the resources).
4. Repeat for genkan.

The existing `menu.tf` / `genkan.tf` are UNCHANGED tonight — the module is opt-in. House doesn't need this module (no tunnel).

### ✓ Conventions document

- `docs/terraform-style.md` — **NEW** — the 10-bullet LLM-friendly HCL conventions from the research (pessimistic version pins, `for_each` over `count`, `validation` blocks, naming grammar, `tofu fmt`/`validate`/`tflint` in CI, etc.). Reference from `AGENTS.md`.

### ✗ Deferred — see rationale above

- Tier 3 (BWS-as-Tofu) — pre-GA provider, ~20mo stale
- Tier 4 (account derivation) — touches every product root, do as one focused PR
- Tier 5 (shared `with-secrets`) — pure DRY, low impact
- Tier 6 (GitOps for Tofu) — overkill for solo

---

## Open questions for when you're back

1. Is the leftover `BETTER_AUTH_SECRET` in the repo's GH secrets safe to delete, or does some workflow I haven't audited depend on it?
2. For Tier 3 (BWS-as-Tofu): if no maintained provider exists, are you OK with the BWS bootstrap loop staying imperative? (My recommendation: yes — it runs once.)
3. Confirm: 4th-product cardinality is N=4 or N=10? If N=4, the module work in Tier 2 is high-value; if N=20+, we'd want a different shape (a single Tofu root iterating over a products map). Today the trade-off favors per-root isolation.
