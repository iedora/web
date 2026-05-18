# Tofu / Terraform style — conventions for LLM-safe HCL

These rules exist because **LLMs produce HCL that parses far more often than HCL that applies.** A closed-loop `validate → plan → fix` is the gap-closer (per Deployability-Centric IaC Generation, arXiv:2506.05623). The bullets below give the closed loop something solid to validate against.

Apply them to every Tofu root in this repo (`infra/tofu/`, `products/*/infra/tofu/`) and every module under `infra/modules/`.

## The ten rules

1. **Pessimistic version pins.** Use `~> X.Y` for every provider and module. Never `>= X.Y`, never unbounded. An LLM editing `versions.tf` will happily upgrade you across a major if the constraint allows it; `~>` blocks that.
2. **`for_each` over `count`. `for_each` over copy-paste.** With `count`, removing element N shifts every subsequent address — state becomes corrupt and the LLM's "fix" creates duplicates. `for_each` keyed on a `set` or `map` keeps addresses stable when a member is removed.
3. **Every input variable has a `validation` block.** Cheapest pre-`apply` gate. Catches `region = "us-east-2"` typos before they cost a `plan` round-trip. Pair with `nullable = false` when required. Examples in `infra/tofu/variables.tf`: `account_id` is regex-validated as 32-char hex; `state_passphrase` must be ≥ 16 chars.
4. **`locals` blocks are short, self-documenting, and named as nouns.** LLMs use the local name as the only hint when generating downstream refs; `local.github_variables` is unambiguous, `local.tmp` is not. One-line comment above any non-obvious local.
5. **One root module per blast-radius unit.** Per-product Tofu roots stay separate. Shared boilerplate goes in `infra/modules/`, not in a consolidated root. Never let an LLM "DRY up by merging menu and house into one root" — the blast-radius isolation is documented as deliberate in `docs/deploy.md`.
6. **CI runs `tofu fmt -recursive`, `tofu validate`, and `tflint`.** The first two are free; tflint with the Cloudflare/GitHub/Tailscale ruleset plugins catches provider-specific errors (e.g. wrong account-id format, dead permission groups). Plan to add these to CI as a follow-up (today they run only ad-hoc).
7. **Plan to a file, apply the file.** `tofu plan -out=plan.bin` then `tofu apply plan.bin` — the apply uses the EXACT plan you reviewed; no race with concurrent state edits. The current `just <product>::deploy` recipes shortcut to `tofu apply -auto-approve` (fine for solo; this rule kicks in when CI auto-applies).
8. **Every sensitive output gets `sensitive = true`.** Prevents accidental log leaks when an LLM `tofu output`s during debugging. Already enforced for tokens (`tunnel_token`, `assets_r2_secret_access_key`, `ci_tailscale_oauth_client_secret`); audit on every new output.
9. **Resource naming grammar.** `<provider>_<noun>.<role>_<qualifier>`. Examples: `cloudflare_dns_record.menu_apex`, `cloudflare_r2_bucket.assets`, `tailscale_oauth_client.ci`. Predictable grammar = LLM can import addresses correctly without guessing.
10. **Every Tofu root has a `README.md`.** Three sentences max — what state owns, what it depends on, the blast-radius. The current product roots have this baked into the top-of-file comments; modules under `infra/modules/` get a dedicated `README.md` (see `infra/modules/cloudflare-tunnel-app/README.md`).

## When to make exceptions

Three places exceptions are reasonable:

- **`count = 0` or `count = 1` as a feature flag.** A single-instance conditional resource is clearer with `count` than `for_each` over a one-element set. The drift risk only matters when N > 1.
- **Unvalidated string inputs that come from another Tofu output.** `data.cloudflare_zone.this.id` doesn't need a `validation` block on the consuming side — the producing data source already guarantees the shape. Validate only at the trust boundary (user input).
- **Unstructured `extra_*` lists.** The `extra_ingress` input on `cloudflare-tunnel-app` is `list(any)` deliberately — Cloudflare's ingress entries vary in shape (some have `hostname`, some have `path`, some have `originRequest`). Strict typing here would block legitimate use.

Skip rule 6 (tofu fmt / validate / tflint in CI) until we actually add it — listed as a follow-up so it doesn't get lost.

## Closed-loop apply (the actual safety net)

The rules above shape WHAT gets written. The safety net is HOW it gets applied:

```bash
# Edit HCL.
tofu fmt
tofu validate                       # syntactic + provider-schema check
tofu plan -out=plan.bin             # see exactly what will change
# Eyeball the plan. If unexpected destroys, STOP.
tofu apply plan.bin                 # exact, no surprises
```

LLMs editing HCL must produce work that survives `validate` AND that humans can sanity-check in `plan` output. If a proposed change makes `plan` unreadable (hundreds of unrelated diffs), the LLM is being asked to do too much in one pass — split.

## Where this fits in the toolchain

- **HashiCorp's terraform-style-guide** Claude Code skill (agentskills.so) — the published guidance this borrows from.
- **Antón Babenko's terraform-skill** (github.com/antonbabenko/terraform-skill) — community-curated, opinionated, broader than this doc.
- **arXiv 2601.08734 (TerraFormer)** and **arXiv 2506.05623 (Deployability-Centric IaC)** — the academic case for the closed loop.

Adopt the bullets here as a project floor; reach for the upstream skills when this doc is silent.
