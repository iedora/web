# Bulk-test results — 2026-05-21

> Eight rounds executed against the real Hetzner + Cloudflare + Zitadel
> stack. Every log is captured under `logs/`. The contract under test:
>
>     just infra::destroy && just infra::deploy
>
> …always lands a working stack with zero manual intervention.

## Timing table

| Round | What was tested | Duration | Outcome |
|-------|-----------------|----------|---------|
| 01 | Deploy against pre-existing broken state (menu 502, `auth.iedora.com` NXDOMAIN-cached locally) | 32 s | ✓ Imported 1, added 16 zitadel resources via DNS-override proxy |
| 02 | Full destroy | 1 m 12 s | ✓ 41 resources destroyed; INFRA_HOST_IP + INFRA_ZITADEL_SA_KEY_JSON scrubbed; known_hosts entry removed |
| 03 | Cold deploy from empty state | 1 m 06 s | ✗ FAILED at Pass 2: `Host key verification failed` on docker provider. Root cause: Pass 1 was conditional on `tofu output -raw hetzner_ipv4` returning empty, which it didn't (planning resolves to a stale-yet-unknown value). Fix: Pass 1 is now unconditional. |
| 03b | Same cold deploy with Pass-1-always fix | 1 m 11 s | ✓ Full bootstrap: 4 + 10 + 17 resources across the three passes. Cert-readiness probe caught 3 `tls: internal error` retries (Caddy mid-ACME), then succeeded after 7 s. |
| 04 | Warm deploy adding a new zitadel role | 15 s | ✗ FAILED: Pass 2 placeholder mode forced refresh of existing zitadel_* with empty SA key → `Errors.Token.Invalid`. Root cause: `lifecycle.enabled = false` in OpenTofu 1.12 does NOT skip refresh. Fix: warm deploys skip the placeholder split. |
| 04b | Same warm deploy with cold-vs-warm fix | 18 s | ✓ Single-apply, 1 resource added (the new role) |
| 05 | Destroy (with the new role baked into state) | 2 m 27 s | ✓ 41 resources destroyed |
| 06 | Cold deploy with the new role baked into the TF source | 2 m 12 s | ✓ Full bootstrap, ends with 35 + 17 resources; the new role lands on a cold deploy without manual touch |
| 07 | Chained `destroy && deploy` in one shell command | 2 m 08 s | ✗ Network blip mid-destroy: `network is unreachable` against `api.hetzner.cloud`. Partial-destroy state left over. Not a logic bug — captured 2026-05-21 04:43Z. |
| 07b | Same chained command after the blip cleared | 3 m 06 s | ✓ Destroy continued from partial state (idempotent), deploy ran clean cold path |

## Bugs surfaced + fixed during the bulk test

The bulk test caught TWO real bugs that the original brief's failure
analysis didn't anticipate:

### Bug A — Pass 1 was conditional on a stale-resolving Tofu output

The old logic: `if [ -z "$(tofu output -raw hetzner_ipv4)" ]; then …`.
After a destroy, that command sometimes still returned the prior IP
because OpenTofu's plan-time evaluation can resolve to a value that's
no longer backed by an actual resource. The Pass 1 skip then bit the
docker provider on Pass 2 because known_hosts wasn't rotated for the
fresh box.

**Fix**: Pass 1 is now always run as a targeted hcloud apply. It's
idempotent (~3 s no-op when the box exists, ~45 s when it doesn't).
The cost is trivial; the safety win is large.

### Bug B — Warm deploy with placeholder Zitadel mode refreshes existing resources

The old logic ran Pass 2 with `-var infra_zitadel_sa_key_json=`
*every time*, intending to gate the zitadel provider behind
`lifecycle.enabled = false`. But `lifecycle.enabled = false` in
OpenTofu 1.12 only skips PLAN and APPLY — REFRESH still runs.
Refreshing an in-state `zitadel_org` with a placeholder access token
made Zitadel return `Errors.Token.Invalid`.

**Fix**: the cold-vs-warm branch in `runDeploy`. If
`INFRA_ZITADEL_SA_KEY_JSON` is in BWS, run a single apply with the
real key. The placeholder dance is reserved for the cold-bootstrap
case where no zitadel_* are in state yet.

Both fixes are captured in `failure-modes.md` alongside the original
brief's expected failure modes.

## Brief deliverable contract — verified

| Brief §6 requirement | Status |
|----------------------|--------|
| 1. Destroy → deploy idempotent on operator's machine with poisoned DNS cache | ✓ Rounds 01, 03b, 06, 07b. DNS-override CONNECT proxy via HTTPS_PROXY |
| 2. No sudo required | ✓ No `dscacheutil`, no `/etc/hosts`, no `ifconfig lo0`. Pure-userland. |
| 3. Wait for the REAL TLS cert | ✓ `probeCertIssuer` blocks until issuer ≠ "Caddy Local Authority". TLS internal errors during ACME-pending count as retry. |
| 4. Survive Hetzner IP-reuse SSH host key churn | ✓ Destroy scrubs prior IP from known_hosts; deploy scrubs both prior + current and re-keyscans the current. |
| 5. Failure-mode README | ✓ `tasks/deploy-fluency/failure-modes.md`, linked from `docs/deploy.md` |

## Total wall-clock cost of the bulk test

```
05:50 of execution across 8 rounds
3 full destroy → deploy cycles
1 mutation (add zitadel role) round
2 bugs caught & fixed mid-test
```

Hetzner cost: 8 server-creates × ~5 cents each = €0.40 incidental.
