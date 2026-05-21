# Task: deploy-fluency

> Folder created on 2026-05-21 to track the implementation of the
> `docs/deploy-fluency-brief.md` brief.

## Goal

Make `just infra::destroy && just infra::deploy` idempotent on the
operator's macOS shell and on the GitHub Actions runner, with zero
manual workarounds:

- no `sudo dscacheutil -flushcache` (NXDOMAIN cache poisoning)
- no `ssh-keygen -R` (IP-recycled host key mismatch)
- no `bws secret delete` (instance-bound secret scrub)
- no surprise "Pass 3 fails because cert is still Caddy's internal CA"

## What landed

| Area | Change | Files |
|------|--------|-------|
| Orchestrator | `bin/iedora deploy` / `destroy` / `doctor` Go binary replaces the giant inline bash in the justfile | `infra/cmd/iedora/`, `infra/bin/iedora` |
| DNS bypass | Localhost HTTP CONNECT proxy with hostname → IP overrides, exported as `HTTPS_PROXY` for Pass 3. Sidesteps the operator's mDNSResponder NXDOMAIN cache. | `infra/cmd/iedora/proxy.go` |
| Cert-ready | Two-stage probe: (a) HTTPS GET /debug/ready=200, (b) leaf cert issuer is NOT `Caddy Local Authority`. Catches the ACME-still-pending edge in brief §4b. | `infra/cmd/iedora/probe.go` |
| Known_hosts hygiene | Destroy auto-scrubs the prior IP's entry; deploy scrubs both the prior IP (from BWS) and the fresh IP. | `infra/cmd/iedora/ssh.go` |
| Maintainability | The two ~80-line bash recipes shrank to one-line `bin/iedora <verb>` shims. All Pass 1/2/3 logic is now type-checked Go with unit tests. | `infra/justfile`, `infra/cmd/iedora/*_test.go` |
| Doctor | `iedora doctor` preflight: PATH, BWS auth, required bootstrap secrets present. | `infra/cmd/iedora/doctor.go` |

## What did NOT change (out of brief scope)

- Tofu encryption config (`infra/tofu/versions.tf`)
- Resource shape — same Pass 1 / Pass 2 / Pass 3 dance, same flags
- The `auth.iedora.com` Caddy/Zitadel chain
- Cloudflare grey-cloud setup
- Choice of `kreuzwerker/docker` over SSH

## Layout

```
tasks/deploy-fluency/
├── README.md                    this file
├── research/findings.md         pulled-from-source notes (no recall)
├── logs/                        every deploy + destroy capture
└── artifacts/                   one-off diagnostics (cert dumps, etc.)
```

## How to verify locally

```
cd infra
go test ./cmd/iedora/ -v     # 7 unit tests, ~0.4s
bin/iedora doctor            # preflight only — no mutation
bin/iedora deploy            # full deploy
bin/iedora destroy           # full teardown
```

The `just infra::deploy` / `destroy` / `doctor` recipes call the same
binary; CI workflows are unchanged because the entrypoint name stayed.

## Bulk-test rounds

See `logs/`. Sequence:

1. `01-deploy-against-existing.log` — deploy against a partially-broken
   live stack (menu 502, auth.iedora.com NXDOMAIN-cached locally).
2. `02-destroy.log` — full teardown.
3. `03-deploy-from-scratch.log` — apply on an empty state.
4. `04-mutation-add-role-deploy.log` — add a Zitadel role, redeploy.
5. `05-destroy.log` — second teardown.
6. `06-deploy-from-scratch.log` — second cold deploy.

Each log starts with a `START <iso8601>` line and ends with `END`. The
gap is the wall-clock cost of that round on a CPX22 in fsn1.
