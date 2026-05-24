# Deploy failure modes — what they look like, why they happen, how to recover

> Companion to `infra/cmd/iedora/`. Each row is a real failure the
> deploy / destroy pipeline tripped over. Knowing the detection
> signature short-circuits the debug arc next time.
>
> See also: [`deploy-validation.md`](deploy-validation.md) — the
> before-you-merge runbook that proactively catches this class of
> failure.

## Active failure modes (post-refactor pipeline)

| Symptom | Stage | Root cause | Recovery |
|---------|-------|------------|----------|
| `Host key verification failed` from kreuzwerker/docker | Stage 2 | Hetzner recycled an IPv4 that's still in operator's `~/.ssh/known_hosts` from a prior instance. | The orchestrator `ssh-keygen -R`s both the prior IP (from BWS `INFRA_HOST_IP`) and the current one before Pass 2 of `iac apply`. If hit manually: `ssh-keygen -R <ip>` and retry. |
| `Error: ... x509: certificate signed by unknown authority` after Zitadel readiness probe | Stage 3 | Caddy served `/debug/ready` via its internal CA while ACME was still completing the TLS-ALPN-01 challenge. | Probe checks the cert issuer (`tlsprobe.probeCertIssuer`) — must NOT be "Caddy Local Authority". If hit: 6-min budget should cover ACME; `ssh root@$HOST docker logs infra-caddy` shows LE rate-limit / firewall issues. |
| `Errors.Target.DeniedURL` on action_target create in `bin/zitadel-apply` | Stage 3 | Zitadel's URL validator can't resolve `menu.iedora.com` from inside the iedora docker network (resolver cached NXDOMAIN before CF DNS propagated). | `zitadel-apply` runs `waitForMenuDNS` before creating action targets — SSHes to the box and `docker exec infra-caddy nslookup menu.iedora.com` until it answers. 90s budget. Increase if it fires. |
| `zitadel-apply` fails with `found N PATs on machine user "menu-sa" (expected 0 or 1)` | Stage 3 | A prior run crashed mid-create OR two operators raced. Concurrent-operator guard refuses to silently delete the wrong one. | Operator reconciles via Zitadel UI: delete extras, leaving the one whose value matches `INFRA_ZITADEL_MENU_SA_TOKEN` in BWS. Re-run `task app:apply`. |
| `task deploy:menu` fails with `BWS missing INFRA_ZITADEL_*` | Stage 4 | Stage 3 didn't complete (or didn't run) — the 6 Zitadel outputs aren't in BWS yet. | Run `task app:apply` first. Or re-run `task up` which chains both. |
| `task deploy:menu` fails with `tofu output X empty` | Stage 4 | Stage 2 didn't run, OR the central tfstate was wiped, OR a new `menu_*` output was added to `outputs.tf` but not applied yet. | Run `task infra:up` to refresh state. Confirm with `infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu output -raw <name>`. |
| `menu-db-migrations` fails with `connection refused` | Stage 3 | `infra-postgres` isn't up. | `ssh root@$HOST docker ps` to confirm. If missing, re-run `task infra:up`. If running but unreachable, `docker logs infra-postgres`. |
| `bws secret create` 409 "already exists" | Stage 2/3/4 | BWS has no native upsert. | The `internal/bws.Upsert` helper lists first, edits if present, creates if absent. If hit directly: `bws secret list | grep <key>` to confirm; `bws secret edit <id>` to update. |
| Destroy aborts mid-flight with `network is unreachable` or `dial tcp: i/o timeout` | iac destroy | Operator's local network blipped, OR Hetzner/CF had a partial outage. State is half-destroyed. | Re-run `task infra:down` (idempotent: state-rm's whatever remains and continues). If it keeps failing, sanity-check `ping 1.1.1.1` and `dig api.cloudflare.com @1.1.1.1`. |
| `iac apply` hangs at "Pass 2: full tofu apply" with no progress | Stage 2 | Cloud-init still installing Docker. `null_resource.docker_ready` (`until docker info`) waits up to 5 min. | `ssh root@<ip> 'cloud-init status'`. If stuck > 10 min, `infra/bin/with-secrets --stage iac -- tofu -chdir=infra/tofu apply -replace=hcloud_server.iedora` to get a fresh box. |

## Detection cheat-sheet

```bash
# Quick triage — no SSH needed.
task doctor                                          # bootstrap secrets present?
dig @1.1.1.1 auth.iedora.com +short                  # does CF know about the record?
dig auth.iedora.com +short                           # does YOUR resolver know?
echo | openssl s_client -connect <ip>:443 \
    -servername auth.iedora.com 2>/dev/null | \
    openssl x509 -issuer -noout                      # is the cert real LE yet?
curl -sS https://menu.iedora.com/up                  # menu container alive?
```

If `dig @1.1.1.1` works but `dig` doesn't, your resolver has a stale
NXDOMAIN — typically clears in ~30s. Stage 3 (`zitadel-apply`) doesn't
hit this anymore because it talks to Zitadel through Caddy on the real
IP and the in-binary `waitForMenuDNS` gate runs from inside the docker
network (not the operator's machine).

## Historical failures (pre-refactor — kept for context)

These were specific to the pre-refactor 3-pass deploy dance + the
Zitadel TF provider. They CANNOT recur in the current pipeline because
the machinery that caused them is gone:

- **mDNSResponder NXDOMAIN cache for `auth.iedora.com`** during the
  Zitadel provider's plan-time discovery. The HTTPS_PROXY DNS-override
  sidecar workaround is also gone — Stage 3's `bin/zitadel-apply`
  doesn't dial Zitadel at plan time (there is no plan; it's a Go
  reconciler), and by the time it runs, `tlsprobe.Wait` has already
  resolved the hostname.
- **`Errors.Token.Invalid (AUTH-7fs1e)` on warm deploys** caused by the
  Zitadel provider's placeholder-auth-mode refresh. The provider is
  gone; the reconciler authenticates with the real SA key always.
- **`tainted` state from a half-failed `local-exec`** for the
  `iedora_admin_grants` null_resource. That null_resource is gone;
  admin grants are now part of `zitadel-apply --grants-only`.

If you see references to "Pass 3", "placeholder Zitadel", "HTTPS_PROXY
proxy", or `zitadel.tf` in any error trace, you're running stale code
— `git pull` and rebuild.
