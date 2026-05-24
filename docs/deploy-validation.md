# Deploy pipeline — end-to-end validation runbook

> Companion to [`infra/cmd/iedora/`](../infra/cmd/iedora/) (Go orchestrator)
> and [`docs/deploy-failure-modes.md`](deploy-failure-modes.md) (post-mortem
> catalogue). This file is the **before-you-merge runbook**: a manual
> sequence that exercises every code path the pipeline owns — cold
> bootstrap, warm idempotence, destroy + reconverge, the DNS-race gate
> inside `bin/zitadel-apply`, per-product Stage 4 deploys, and the BWS
> write-throughs.
>
> Run it whenever you change anything that affects how the estate is
> created or torn down (see the [Hard rule](#hard-rule) below for the
> exact paths). The sequence takes **~30–40 minutes** end-to-end and
> spins real cloud resources. Don't skip it on deploy-shaped changes.

## Hard rule

After modifying any of:
- `infra/cmd/iedora/*.go` (orchestrator: iac / app / deploy / pipeline / runtimes / configurator registry)
- `infra/cmd/with-secrets/*.go` (stage-filtered env wrapper)
- `infra/cmd/bws-upsert/*.go`
- `infra/cmd/zitadel-apply/*.go` (Stage 3 configurator)
- `infra/cmd/menu-db-migrations/*.go` (Stage 3 configurator)
- `infra/openobserve/bin/apply-dashboards` (Stage 3 configurator)
- `infra/internal/{tlsprobe,r2,cloudflare,bws}/*.go`
- `infra/tofu/*.tf` (`containers.tf`, `main.tf`, `hetzner.tf`, `github.tf`, `secrets.tf`, `outputs.tf`)
- `infra/bin/{with-secrets,iedora,bws-upsert,zitadel-apply,menu-db-migrations}`
- `Taskfile.yml`
- `products/*/infra/tofu/*.tf`

…run the full sequence below. **One failed step ⇒ do not merge.** Unit
tests (`go test ./...`) cover individual helpers (with-secrets stage
filter, R2 SigV4 escapes, retry chain) in isolation; this runbook is
the only thing that proves the moving parts compose correctly against
live cloud APIs.

## The sequence

Run from the repo root. Each step blocks until the previous is `✓`.

```bash
task down       # 1: tear down (idempotent — works from any state)
task up         # 2: cold deploy (full bootstrap: infra → app → deploy)
task up         # 3: warm deploy (should be a no-op across all stages)
task down       # 4: destroy from a full estate
task up         # 5: cold deploy AGAIN (catches state-vs-cloud drift, DNS races)
task up         # 6: warm deploy (final no-op check)
```

The second cold/destroy pair (steps 4–5) is the load-bearing part. It
catches:

- **DNS race** inside `bin/zitadel-apply` between the new
  `cloudflare_dns_record.menu_iedora` (just landed in Stage 2) and
  `zitadel-apply`'s `POST /resources/v3alpha/targets` (Stage 3 —
  Zitadel's URL validator dials `menu.iedora.com` from inside the
  iedora docker network). Mitigated by `wait_dns.go`'s SSH probe of
  `docker exec infra-caddy nslookup menu.iedora.com`.
- **Orphan handling**: prior crashed runs may have left Hetzner/CF/GH
  resources without state entries. Step 1's destroy on an "already
  empty" state must converge cleanly.
- **House-vs-central state isolation**: a CWD bug in `bin/with-secrets`
  silently routed house's `tofu` calls at the central state until
  caught here (fix: `ORIG_PWD` passthrough in the bash wrapper +
  `os.Chdir` in the Go side).
- **One-shot reveal recovery**: `bin/zitadel-apply` recovery matrix
  (PAT, signing keys) is most likely to break on a second cold cycle
  where Zitadel has stale resources but BWS was scrubbed.

## What each step asserts

| Step | Path exercised | Expected outcome |
|---|---|---|
| 1. destroy | `iedora iac destroy` — state-rm docker_* → R2 bucket-empty → tofu destroy → BWS scrub (incl. 6 INFRA_ZITADEL_*) → known_hosts scrub. Plus per-product destroy (house) | `✓ iac destroy complete`, all `Destroyed` markers, `house destroy complete` |
| 2. cold deploy | `task up` chains `iac apply` → `app apply` → `deploy:all`. Cold has SA-key fetch in Stage 3 (SSH+docker). | `iac apply complete` → `tlsprobe ✓ ready after Xs` → `zitadel-apply: org=… project=… app=…` → `menu-db-migrations complete` → `openobserve-dashboards in sync` → `deploy menu complete` + `deploy house complete` |
| 3. warm deploy | Same chain but everything is no-diff. SA key already in BWS, every Zitadel resource matches, migrations idempotent (drizzle skips applied), dashboards idempotent (hash match), Stage 4 re-pulls same SHA. | All "no diff" / "no changes". Menu container does NOT restart. Total runtime ~30–60s. |
| 4. destroy (full) | Same as #1 but from a populated state | `Resources: ~25 destroyed`, R2 buckets emptied + dropped (proves `internal/r2.EmptyBucket` works), house destroy complete. **Note**: no more state-rm of `zitadel_*` (they're not in state). |
| 5. cold deploy #2 | Same as #2. Critical: the DNS gate inside `bin/zitadel-apply` must fire and target creation must succeed on first try. | Same markers as #2. If `Errors.Target.DeniedURL` appears here, `wait_dns.go` budget needs tuning. |
| 6. warm deploy | Same as #3. Final idempotency check. | Same as #3. |

## Verifying state + cloud after a destroy

After steps 1 and 4, the state files AND the cloud should both be empty
of iedora-managed resources. Quick post-checks:

```bash
# State should be empty (zero lines).
infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu state list | wc -l
infra/bin/with-secrets --stage deploy --product house -- tofu -chdir=products/house/infra/tofu state list | wc -l

# Hetzner: no iedora-* resources.
task bws -- sh -c 'HCLOUD_TOKEN=$INFRA_HCLOUD_TOKEN hcloud server list'
task bws -- sh -c 'HCLOUD_TOKEN=$INFRA_HCLOUD_TOKEN hcloud firewall list'

# Cloudflare: no iedora-* R2 buckets, no DNS records for auth/menu/obs/assets.iedora.com.

# BWS: instance-bound keys should be gone.
bws secret list | grep -E "INFRA_ZITADEL_(SA_KEY|MENU|PERMISSIONS|GRANTS|IEDORA)|INFRA_HOST_IP|AUTOGEN_INFRA_MENU_SESSION_SECRET" || echo OK_SCRUBBED

# GitHub: no actions vars/secrets (Tofu manages them, destroy nukes them).
gh variable list --repo eduvhc/iedora
gh secret list --repo eduvhc/iedora
```

Any iedora-managed leftovers = destroy path regression. Don't merge.

## Verifying counts after a cold deploy (steps 2 + 5)

After a successful `task up`:

| Store | Where | Roughly |
|---|---|---|
| Central `tofu` state | `infra/tofu/` | ~40 resources: hcloud {server, firewall, ssh-key}, docker_{network, volume}, the shared `module.*` containers (postgres / zitadel / zitadel-login / openobserve / backups / caddy_data), cloudflare_{r2_bucket, dns_record, api_token}, github_actions_{secret, variable}, random_password.*, terraform_data.bws_sync_autogen. **No zitadel_***, **no menu_web docker_container**. |
| House `tofu` state | `products/house/infra/tofu/` | ~3 resources: cloudflare_workers_script.house, cloudflare_workers_custom_domain.apex, data.cloudflare_zone.iedora |
| BWS | Stage-3 outputs from `bin/zitadel-apply` | `INFRA_ZITADEL_MENU_OIDC_CLIENT_ID`, `..._OIDC_CLIENT_SECRET`, `..._SA_TOKEN`, `INFRA_ZITADEL_PERMISSIONS_SIGNING_KEY`, `..._GRANTS_SIGNING_KEY`, `INFRA_ZITADEL_IEDORA_PROJECT_ID`, plus `AUTOGEN_INFRA_MENU_SESSION_SECRET` (minted by Stage 4) |
| Zitadel | Reconciled via REST | org `iedora`, project `iedora`, 6 roles (`iedora-admin` + 5 `qr-codes:*`), machine user `menu-sa` with 1 PAT and IAM_OWNER, OIDC app `menu`, 2 action targets (`menu-permissions`, `menu-grants`) with their executions |
| Box | `ssh root@$HOST docker ps` | `infra-postgres`, `infra-zitadel`, `infra-zitadel-login`, `infra-caddy`, `infra-openobserve`, `infra-backups`, `infra-menu-web` (Stage 4 ran) |

## Common failure shapes and what they mean

| Symptom | Likely cause | Where to fix |
|---|---|---|
| Stage 2 fails: `SSH key not unique` / `409 Already exists` | State empty but cloud has orphans from a prior crashed destroy. | Manually delete the orphans (see "Verifying state + cloud" above), then re-run. The orchestrator deliberately doesn't auto-clean. |
| R2 bucket destroy hangs 30s then 409s `bucket not empty` | `internal/r2.EmptyBucket` failed silently. | Read the `! R2 empty failed` line in the destroy log. Likely the CF token lost R2 perms or the SigV4 escape rules regressed. Check `infra/internal/r2/r2_test.go` is still green. |
| Stage 3 fails: `Errors.Target.DeniedURL` on action_target create | `wait_dns.go` budget exhausted OR the probe doesn't reflect Zitadel's resolver view anymore. | Check `infra/cmd/zitadel-apply/wait_dns.go`. The 90s budget assumes infra-caddy's nslookup matches Zitadel's resolver. If that changes, the probe needs to move into the Zitadel container (or a `--network iedora` sidecar). |
| Stage 3 fails: `found N PATs on machine user "menu-sa"` | Concurrent-operator guard. Two runs created PATs in parallel; reconciler refuses to delete the wrong one. | Operator reconciles via Zitadel UI; re-run `task app:apply`. |
| Stage 4 fails: `BWS missing INFRA_ZITADEL_X` | Stage 3 didn't complete OR was skipped. | `task app:apply` first, then `task deploy:menu`. |
| Warm deploy shows `N added / N changed` instead of `0/0/0` | Tofu plan drift, OR a configurator detected real Zitadel-side drift (someone clicked around in the UI). | Read the diff; commit the state + reason; do not merge until warm deploy is fully idempotent. |
| `house deploy failed: known Cloudflare transient (10007 on assets-upload-session)` | CF's assets pipeline is in a transient 500 window (see workers-sdk#11153). | Wait 15–30 min, re-run `task deploy:house`. |

More entries in [`deploy-failure-modes.md`](deploy-failure-modes.md).

## When NOT to run this

- Pure docs / `.md` edits — no deploy code touched.
- Edits below `products/menu/src/**` (app code; covered by Vitest/Playwright in `docs/testing.md`).
- Edits to `packages/**` (workspace libraries; their own test suites cover them).
- CI workflow edits that don't touch the orchestrator or the `*.tf` — the workflow on the next push is the validation.

For everything else listed in the [Hard rule](#hard-rule), running this
sequence is cheaper than debugging a half-broken deploy in production.
