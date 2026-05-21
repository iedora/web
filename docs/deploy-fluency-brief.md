# `just infra::deploy` fluency — analysis & research brief

> Brief for a follow-up agent that will harden the `infra/justfile` deploy
> recipe so a single `just infra::destroy` followed by `just infra::deploy`
> always lands a working stack with zero manual intervention, on both
> CI runners and the operator's macOS shell.

## 1. Goal

The contract this recipe must satisfy:

```
just infra::destroy && just infra::deploy
```

…ends with:

- every Tofu-managed resource present (Hetzner box, Cloudflare DNS + R2 +
  tokens, GitHub Actions config, every Docker container, every zitadel_*
  resource in state),
- `https://auth.iedora.com/.well-known/openid-configuration` reachable
  with a valid Let's Encrypt cert from the operator's shell,
- `menu.iedora.com` returning the live menu (not a 502),
- BWS holding the **new** `INFRA_ZITADEL_SA_KEY_JSON` + `INFRA_HOST_IP`
  (the destroy must scrub the previous instance's values).

No manual `sudo dscacheutil -flushcache`, no manual `ssh-keygen -R`, no
manual `bws secret delete`, no manual `tofu apply` patch-ups.

## 2. What the recipe does today

`infra/justfile :: deploy` runs three passes:

| Pass | When | What |
|------|------|------|
| **1/3** | hetzner_ipv4 output empty | Targeted apply for `hcloud_ssh_key.operator` + `hcloud_firewall.iedora` + `hcloud_server.iedora` + `null_resource.docker_ready` (the docker-readiness barrier). Then capture IPv4 + `ssh-keygen -R` + `ssh-keyscan -H` into `~/.ssh/known_hosts`. |
| **2/3** | always | `tofu apply -var infra_zitadel_sa_key_json=""` — placeholder mode, so the zitadel TF provider's eager OIDC discovery is bypassed. Lands DNS + R2 + GitHub config + every container. Wait loop polls `https://auth.iedora.com/debug/ready` via `curl --resolve` (bypasses operator DNS cache). |
| **3/3** | always | If `INFRA_ZITADEL_SA_KEY_JSON` not in BWS, fetch it from the `zitadel-bootstrap` volume (via the `zitadel-fetch-sa-key` recipe) and upload. Then a final `tofu apply` with the real SA key — provider Configure() now runs OIDC discovery, plan lands `zitadel_org/project/role/grant/action_target/execution_function`. |

`infra/justfile :: destroy` runs three steps: state-rm every `zitadel_*` +
provisioner `null_resource`s; `tofu destroy` with
`allow_masterkey_rotation=true` + `infra_zitadel_sa_key_json=""`; then
scrubs `INFRA_ZITADEL_SA_KEY_JSON` + `INFRA_HOST_IP` from BWS.

The two SA-key + host-IP entries are instance-bound — leaving them in BWS
after a destroy makes the next deploy reuse stale material that won't
authenticate against the new Zitadel.

## 3. Already-fixed pitfalls (do NOT redo)

1. **`tofu output -raw <missing>` exits 0** — the old Pass 1 gate
   `if ! tofu output -raw hetzner_ipv4 >/dev/null 2>&1` never triggered
   because tofu writes a Warning and exits 0 even when the output is
   absent. Now: capture stdout, test for emptiness.

2. **`ssh-keyscan` gated on `[ -t 0 ]`** — meant to skip in CI, but skipped
   anything non-tty (including invocation via tools). Now: runs
   unconditionally; CI also runs its own `ssh-keyscan` before the recipe.

3. **Stale SA key in BWS after destroy** — destroy now scrubs both
   `INFRA_ZITADEL_SA_KEY_JSON` and `INFRA_HOST_IP`.

4. **Pass 1.5 (Zitadel mid-restart recovery)** — fired on fresh deploy
   when DNS for `auth.iedora.com` wasn't in state yet, then waited
   forever. Replaced with the placeholder-first / wait / real-key
   pattern in Pass 2 + Pass 3.

## 4. Open problems

Two failures observed in the most recent destroy → deploy round-trip:

### 4a. Operator DNS cache poisons Pass 3's TF provider discovery

The wait loop in Pass 2 returns 200 (via `curl --resolve`). But the final
`tofu apply` in Pass 3 fails with:

```
Error: failed to start zitadel client: OpenID Provider Configuration Discovery has failed
```

Root cause: the zitadel TF provider's Configure() does
`GET https://auth.iedora.com/.well-known/openid-configuration` using the
Go HTTP client, which goes through macOS's `mDNSResponder`, which has
NXDOMAIN cached for `auth.iedora.com` from before the record existed.

`--resolve` is a libcurl trick the TF provider can't use. The provider has
a `domain` + `port` field but no IP override and no resolver hook.

Cloudflare DNS publishes the record within seconds (`dig @1.1.1.1` works).
The operator's resolver (`192.168.50.53` in this case) has a long
negative TTL from the NXDOMAIN response when `auth.iedora.com` didn't
exist yet.

### 4b. ACME cert provisioning lags `/debug/ready=200`

Caddy serves `/debug/ready` via its internal CA cert while ACME is still
processing the TLS-ALPN challenge. Once ACME completes (30-60s after
Caddy boots), Caddy switches to the Let's Encrypt cert. The wait loop's
`curl` happens to accept the internal CA (or it doesn't — we never
verified), so the loop exits before the LE cert lands.

The Go TF provider rejects the internal CA → OIDC discovery fails until
the LE cert is live.

## 5. Research targets

The agent must consult source code + docs from the latest tag of each
project (never recall — git is authoritative). Specific things to look
for:

### 5a. OpenTofu / Terraform deploy orchestration

- **opentofu/opentofu** (github.com) — does the CLI expose a JSON output
  with a discriminator between "no outputs in state" vs "output exists
  but empty"? `tofu output -json` returns `{}` for empty state vs the
  expected map. Useful for a safer Pass 1 gate.
- **opentofu/opentofu** docs/`v1.12+/cli/commands/output` — confirm the
  exit-code contract; document the behavior in the recipe.
- **hashicorp/terraform** issue tracker — search "output raw missing
  exit code" for design-intent discussion.

### 5b. Two-phase / placeholder-mode bootstrap patterns

Pattern: provider needs an upstream that another resource creates →
target placeholder credential for first pass, real for second.

- **hashicorp/vault** `bootstrap/` and the `terraform-provider-vault`
  examples — how do they handle the chicken/egg of Vault provisioning
  Vault itself.
- **kelseyhightower/kubernetes-the-hard-way** — bootstrap order patterns
  (etcd → kube-apiserver → join).
- **bitnami-labs/sealed-secrets** — controller bootstraps Bitnami keys
  before any secret can be sealed.
- **zitadel/zitadel** `e2e/` + their own example TF in
  github.com/zitadel/terraform-provider-zitadel/examples — how do they
  recommend bootstrapping the first instance + SA key in production.
- **smallstep/cli** + **step-ca** docs — their `step ca bootstrap` runs
  the same chicken/egg with the CA's own ACME.

### 5c. Cloud-init / SSH host key churn on IP reuse

- **hetznercloud/hcloud-cloud-controller-manager** — known issue?
- **canonical/cloud-init** modules `cc_ssh.py` — when exactly does it
  regenerate host keys (boot stage, blocking vs non-blocking).
- **gravitational/teleport** — they have to handle SSH host key trust
  programmatically.
- **CoreOS/Ignition** — alternative to cloud-init, sometimes more
  predictable about key generation timing.

### 5d. DNS cache invalidation in deploy scripts

- **kubernetes/kubeadm** — how do they handle the control-plane endpoint
  DNS lookup race during `kubeadm init`.
- **cert-manager/cert-manager** — the `dns01` solver's authoritative
  resolver override; uses `--dns-recursive-nameservers` to bypass
  local cache. Look for the pattern in `pkg/dns`.
- **caddyserver/caddy** — `acmez` library's TLS-ALPN-01 challenge, how
  it self-resolves the challenge target (not via the host resolver).
- **letsencrypt/boulder** — Let's Encrypt's own resolver pinning when
  validating challenges.

### 5e. Cert-ready (not just port-open) probes

- **traefik/traefik** — how their docs recommend waiting for the
  ACME-managed cert in CI; does Traefik expose a "cert obtained"
  signal?
- **caddyserver/caddy** — admin API (`/config/`, `/pki/`) — is there an
  endpoint that reports the active issuer for a given site?
- **smallstep/certificates** — the step-ca admin API surface.
- **jetstack/cert-manager** — `cmctl status certificate` semantics.

### 5f. Secret manager teardown / scrub patterns

The destroy recipe currently shells out to `bws secret delete`. Look
for first-class teardown patterns:

- **bitwarden/sdk-sm** (Secrets Manager SDK) — does it expose a
  declarative "secret should not exist" surface, or only imperative
  delete?
- **getsops/sops** — they treat secrets as files; teardown == git rm.
- **mozilla/sops** (legacy) — same pattern.
- **dopplerhq/cli** — `doppler secrets delete` API.
- **infisical/infisical** — Terraform provider for declarative secret
  lifecycle.
- **HashiCorp Vault** + **terraform-provider-vault** — `vault_generic_secret`
  destroy semantics; can we declare instance-bound secrets *inside* Tofu
  so they vanish with the state?

The deepest question: should `INFRA_ZITADEL_SA_KEY_JSON` be a Tofu
resource (e.g. via the `bitwarden-secrets` community provider, or a
`null_resource` with a `provisioner "local-exec" { when = destroy }`)?
That would obviate the imperative scrub step.

Candidate community providers:
- **maxlaverse/terraform-provider-bitwarden** — manages Bitwarden Password
  Manager (not Secrets Manager).
- **registry.terraform.io/maxlaverse/bitwarden-secrets** — search if it
  exists and supports BWS.

### 5g. Big OSS projects that ship a `just`/`make` deploy + Tofu

Cross-pollinate from projects that already solved this:

- **gitlab-org/gitlab** — their cloud-deploy scripts
  (`scripts/cloud-deploy`).
- **mastodon/mastodon** — `terraform/` examples for the `hometown` fork.
- **plausible/community-edition** — `/terraform/` for the self-host
  community edition.
- **immich-app/immich** — multi-tenant infra reference.
- **outline/outline** — they document a single-VPS deploy.
- **n8n-io/n8n** — `docker/` + their k8s helm chart for inspiration.
- **supabase/supabase** — `supabase/postgres` bootstrap scripts (Postgres
  + multiple downstream services).

Specifically look at:
- Do they have a `just destroy` companion? How does it interact with
  ingress + cert state?
- Do they ever do a two-phase apply, or do they sidestep eager-Configure
  providers altogether?

### 5h. Specific docs to consult from git (latest version)

Pull these from the **default branch** of each repo, not memory:

- `opentofu/opentofu/website/docs/cli/commands/output.mdx`
- `opentofu/opentofu/website/docs/language/state/remote.mdx`
- `zitadel/terraform-provider-zitadel/README.md` + `docs/index.md`
- `zitadel/zitadel/docs/docs/self-hosting/manage/configure/secrets.md`
- `caddyserver/caddy/admin.md` (admin API)
- `bitwarden/sdk-sm/crates/bws/README.md` (current bws CLI surface)
- `kreuzwerker/terraform-provider-docker/docs/index.md` (SSH host config)

## 6. Deliverable

A patched `infra/justfile` (deploy + destroy) and any supporting Tofu
changes that:

1. Make destroy → deploy idempotent on the operator's machine even
   with poisoned DNS cache from the previous instance.
2. Don't require sudo (a one-time `defaults write` or `~/.ssh/config`
   block at first run is acceptable if documented).
3. Wait for the **real** TLS cert, not just port 443 reachable.
4. Survive the Hetzner IP-reuse SSH host key churn end-to-end (already
   working in the happy path; needs hardening for edge cases — what if
   Pass 1's `null_resource.docker_ready` returns before sshd finishes
   second-stage host key regen? Is that even a thing on Ubuntu 24.04
   cloud images?).
5. Have a short README under `docs/deploy.md` that lists the failure
   modes + their detection signatures, so future operators don't repeat
   the debug arc.

## 7. Working files

- `infra/justfile` — the deploy + destroy recipes (read top-to-bottom).
- `infra/cmd/with-secrets/env.go` — how BWS secrets become `TF_VAR_*`
  (esp. the `infra_zitadel_sa_key_json` line).
- `infra/tofu/zitadel.tf` — `local.zitadel_bootstrapped` gate, provider
  config, role + grant + execution resources.
- `infra/tofu/containers.tf` — `module.zitadel`, `docker_container.menu_web`,
  `module.caddy` (CRITICAL: this is where `auth.iedora.com` becomes a
  Caddy site).
- `infra/tofu/hetzner.tf` — `hcloud_server.iedora` cloud-init + the
  `null_resource.docker_ready` SSH barrier.
- `infra/tofu/main.tf` — `cloudflare_dns_record.auth_iedora` (the record
  whose propagation Pass 3 depends on).
- `.github/workflows/infra-deploy.yml` — CI's invocation of the recipe,
  so the agent can verify the same flow works for the GitHub Actions
  runner (which doesn't have the macOS DNS cache problem but has its
  own quirks).

## 8. Out of scope

- Rewriting the SA-key bootstrap as a Zitadel provider feature.
- Switching off Cloudflare DNS (the grey-cloud A-record is load-bearing
  for the Caddy/Let's Encrypt TLS-ALPN-01 challenge).
- Changing the choice of `kreuzwerker/terraform-provider-docker` for
  remote Docker over SSH (the SSH host key issue would persist with any
  provider that goes through the system ssh client).
- Anything in `products/menu/` — this brief is infra-only.
