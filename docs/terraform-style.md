# Tofu / Terraform style — LLM-safe HCL conventions

LLMs produce HCL that parses far more often than HCL that applies. The bullets below give a closed-loop `validate → plan → fix` something solid to validate against.

Apply to every Tofu root and module in `infra/`.

## The ten rules

1. **Pessimistic version pins.** Use `~> X.Y` for every provider and module. Never `>=`, never unbounded.
2. **`for_each` over `count`. `for_each` over copy-paste.** `count` shifts addresses when an element is removed; `for_each` keyed on a set/map keeps them stable.
3. **Every input variable has a `validation` block.** Cheapest pre-`apply` gate. Pair with `nullable = false` when required.
4. **`locals` blocks are short, self-documenting, named as nouns.** `local.github_variables` is unambiguous; `local.tmp` is not.
5. **One root module per blast-radius unit.** Per-product Tofu roots stay separate. Shared code goes in `infra/modules/`, not in a consolidated root.
6. **CI runs `tofu fmt -recursive`, `tofu validate`, and `tflint`.** Planned; not yet wired.
7. **Plan to a file, apply the file.** `tofu plan -out=plan.bin` then `tofu apply plan.bin` — no race with concurrent state edits.
8. **Every sensitive output gets `sensitive = true`.** Prevents accidental log leaks.
9. **Resource naming grammar.** `<provider>_<noun>.<role>_<qualifier>`. Examples: `cloudflare_dns_record.menu_apex`, `cloudflare_r2_bucket.assets`.
10. **Every Tofu root has a `README.md`.** Three sentences max — what state owns, what it depends on, the blast-radius.

## Exceptions

- **`count = 0` or `count = 1` as a feature flag.** Clearer than `for_each` over a one-element set.
- **Unvalidated string inputs from another Tofu output.** Validate only at the trust boundary (user input).
- **Unstructured `extra_*` lists.** `list(any)` is deliberate when downstream shape varies (Cloudflare ingress entries).

## Closed-loop apply

```bash
tofu fmt
tofu validate                       # syntactic + provider-schema check
tofu plan -out=plan.bin             # see exactly what will change
# Eyeball. Unexpected destroys → STOP.
tofu apply plan.bin
```

If a proposed change makes `plan` unreadable (hundreds of unrelated diffs), the change is too big — split it.
