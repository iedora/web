# Tofu / Terraform style — LLM-safe HCL conventions

LLMs produce HCL that parses far more often than HCL that applies. The bullets below give a closed-loop `validate → plan → fix` something solid to validate against.

Apply to every Tofu root and module in `infra/`.

## The ten rules

1. **Pessimistic version pins.** Use `~> X.Y` for every provider and module. Never `>=`, never unbounded.
2. **`for_each` over `count`. `lifecycle.enabled` over `count = X ? 1 : 0`. `for_each` over copy-paste.** `count` shifts addresses when an element is removed; `for_each` keyed on a set/map keeps them stable. For zero-or-one gates use `lifecycle { enabled = expr }` (OpenTofu 1.11+) — the resource lives at its canonical address (no `[0]` index in references) when enabled, has zero instances when not.
3. **Every input variable has a `validation` block.** Cheapest pre-`apply` gate. Pair with `nullable = false` when required.
4. **`locals` blocks are short, self-documenting, named as nouns.** `local.github_variables` is unambiguous; `local.tmp` is not.
5. **One root module per blast-radius unit.** Per-product Tofu roots stay separate. Shared code goes in `infra/modules/`, not in a consolidated root.
6. **CI runs `tofu fmt -recursive`, `tofu validate`, and `tflint`.** Planned; not yet wired.
7. **Plan to a file, apply the file.** `tofu plan -out=plan.bin` then `tofu apply plan.bin` — no race with concurrent state edits.
8. **Every sensitive output gets `sensitive = true`.** Prevents accidental log leaks.
9. **Resource naming grammar.** `<provider>_<noun>.<role>_<qualifier>`. Examples: `cloudflare_dns_record.menu_apex`, `cloudflare_r2_bucket.assets`.
10. **Every Tofu root has a `README.md`.** Three sentences max — what state owns, what it depends on, the blast-radius.

## Exceptions

- **Unvalidated string inputs from another Tofu output.** Validate only at the trust boundary (user input).
- **Unstructured `extra_*` lists.** `list(any)` is deliberate when downstream shape varies (Cloudflare ingress entries).

## Refactoring & deletes — `removed {}` + `lifecycle { destroy = false }`

Two declarative levers for removing resources from a TF root without destroying them in the wild:

- **`removed {}` block** — drops a resource from state. Used during a refactor when the resource moves to a different root, gets renamed without a `moved {}`-able shape, or simply stops being managed here. Replaces the imperative `tofu state rm`.
- **`lifecycle { destroy = false }`** (OpenTofu 1.12+) — on the resource itself. When the resource is later removed from configuration, TF treats the destroy as a no-op (resource stays alive in the wild, just exits state).

Combined pattern: removing a managed resource without nuking the remote object.

```hcl
removed {
  from = cloudflare_dns_record.legacy_genkan
  lifecycle {
    destroy = false   # state-only removal; the DNS record stays in CF
  }
}
```

When to reach for it:
- Decommissioning a feature whose state owns out-of-state cleanup (legacy genkan tunnels, old DNS records pre-consolidation).
- Handing off ownership: TF stops managing a resource, another tool / human takes over.
- Recovery after a partial `tofu destroy` (some resources got deleted, some didn't, and the survivors need to drop out of state without TF trying to destroy them again).

Anti-pattern: don't reach for `tofu state rm` from the CLI — that's the imperative equivalent, leaves no audit trail, and gets forgotten the next time someone refactors the same resource.

> Keep the `removed {}` block in the .tf for ONE PR cycle (so the state migration applies cleanly), then delete the block in the next PR. Don't accumulate.

## Closed-loop apply

```bash
tofu fmt
tofu validate                       # syntactic + provider-schema check
tofu plan -out=plan.bin             # see exactly what will change
# Eyeball. Unexpected destroys → STOP.
tofu apply plan.bin
```

If a proposed change makes `plan` unreadable (hundreds of unrelated diffs), the change is too big — split it.
