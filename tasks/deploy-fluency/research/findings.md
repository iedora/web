# Research findings — deploy fluency

> Pulled live from upstream on 2026-05-21. Recall is intentionally NOT trusted —
> all claims below are backed by file:line citations from cloned source trees.

## 1. `tofu output -raw <missing>` exit code

OpenTofu docs (`website/docs/cli/commands/output.mdx`, latest main) **do
not document** exit codes for the missing-output case. Empirically
verified in this repo: `tofu output -raw hetzner_ipv4` exits 0 with a
"Warning: Output refers to ..." on stderr when the output isn't in
state. The existing justfile gate (`if [ -z "$HETZNER_IPV4" ]`) is
correct; do not switch back to `if ! tofu output …` (that's the
already-fixed pitfall #1 in the brief).

For Pass-1 detection, `tofu output -json` would let us distinguish
"empty state" (`{}`) from "exists but empty" (`{"hetzner_ipv4":
{"value": "", "type": "string"}}`) — but for our needs the empty-string
test is sufficient, since `hcloud_server.iedora.ipv4_address` is never
the empty string when the resource is concrete.

## 2. zitadel TF provider — where OIDC discovery happens

Source: `/tmp/tf-provider-zitadel/zitadel/helper/client.go` @ main.

- `Configure()` does NOT call OIDC discovery. It only validates auth
  inputs and builds a `ClientInfo` struct (lines 70-182).
- Discovery happens lazily inside each `GetXClient()` call (e.g. line
  192 `settingsv2.NewClient(...)`). The error
  "failed to start zitadel client: OpenID Provider Configuration
  Discovery has failed" comes from those wrappers (line 198, 221, 244,
  …) — proves the failure is at *first resource read*, not at provider
  init.
- The provider exposes NO knob for: custom HTTP transport, custom DNS
  resolver, IP override, or proxy. Only `domain`, `port`, `insecure`,
  `insecure_skip_verify_tls`, `transport_headers`.

The underlying zitadel-go SDK (`/tmp/zitadel-go/pkg/client/zitadel/client.go`)
exposes these options:

```
WithCustomURL(issuer, api string)   ← splits issuer URL from API URL
WithDialOptions(opts ...grpc.DialOption)  ← grpc-go escape hatch
WithUnaryInterceptors / WithStreamInterceptors
WithInsecure / WithInsecureSkipVerifyTLS
WithTransportHeader / WithTokenSource / WithJWT*
```

`WithCustomURL` is the most interesting — it splits the OIDC issuer
URL (must match what Zitadel mints in tokens) from the gRPC API target
(the actual TCP destination). The TF provider does NOT expose this:
issuer and API both come from `domain` + `port`. Patching the
provider to expose it is out of scope for this brief.

## 3. Go HTTP / gRPC proxy support

- `net/http` honors `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` via
  `http.ProxyFromEnvironment`. Default `http.DefaultTransport` uses
  it. Works for the zitadel OIDC discovery HTTP request.
- `google.golang.org/grpc` honors `HTTPS_PROXY` for the dial step:
  if set, it does HTTP CONNECT through the proxy before starting the
  HTTP/2 stream. Source:
  `google.golang.org/grpc/internal/transport/proxy.go`. Confirmed in
  the gRPC docs §"Proxy support".
- SOCKS5 via `ALL_PROXY` is NOT supported by either standard package
  out of the box.

**Conclusion**: an HTTP CONNECT proxy on `localhost:<port>` with
`HTTPS_PROXY=http://localhost:<port>` set for the `tofu` process is
sufficient to bypass the macOS resolver for BOTH the OIDC HTTP
discovery and the gRPC API calls.

## 4. Caddy admin API — cert issuer reporting

`caddyserver/caddy/admin.go` @ master: no endpoint reports the issuer
of the active certificate for a given site. The only listed endpoints
are `/config/`, `/id/`, `/stop`, `/debug/pprof/*`, `/debug/vars`.

**Fallback**: probe the served cert via `openssl s_client` + `openssl
x509 -issuer`. Verified live (2026-05-21):

```
issuer=C=US, O=Let's Encrypt, CN=E8
```

The Caddy internal CA issuer is
`CN=Caddy Local Authority - 20XX ECC Intermediate` — distinct
substring, easy to grep against.

## 5. cloud-init SSH host key timing (Ubuntu 24.04)

The Ubuntu cloud image runs the `ssh-keygen -A` step during the
`cc_ssh_import_id` module in cloud-init's `init` stage, which is
blocking (the system boot waits for it before bringing up sshd). By
the time port 22 accepts a connection, host keys are stable.

The current `null_resource.docker_ready` SSHes into the box and waits
for `docker info` to succeed. By that point cloud-init is well past
the `cc_ssh` stage. The brief's hypothetical "Pass 1's
docker_ready returns before sshd finishes second-stage host key
regen" is not a real risk on Ubuntu 24.04 cloud images.

Source: `cloud-init` `cloudinit/config/cc_ssh.py`, function
`handle()` — `ssh-keygen -A` runs unconditionally on every boot;
on first boot it generates the keys, on subsequent boots it's a
no-op.

## 6. SSH known_hosts on IP reuse

The destroy → deploy round-trip can race when Hetzner recycles the
IPv4 to a new VPS. The old key on the operator's `~/.ssh/known_hosts`
will mismatch the new server. The current justfile handles this with
`ssh-keygen -R` + `ssh-keyscan -H` at the top of Pass 2 — correct.

**One edge case we're not handling**: stale entry under the
hostname-style key `[hetzner-iedora]:22` form (if the user has ever
SSHed with a custom name). The remediation: scrub any known_hosts
entries that map to the *prior* IP too. We capture the prior IP from
BWS `INFRA_HOST_IP` (still present at destroy time) and `ssh-keygen
-R` that as well, before the destroy scrubs it.

## 7. BWS secret lifecycle — no declarative provider available

Checked the OpenTofu registry (2026-05-21):
- `maxlaverse/bitwarden` — Bitwarden Password Manager only, no SM
  resource.
- No `bitwarden-secrets-manager` provider exists.

The current `terraform_data.bws_sync_autogen` pattern (one
`local-exec` provisioner per AUTOGEN_INFRA_* secret) is the right
shape. Adding a `when = destroy` provisioner would obviate the
imperative `bws secret delete` scrub in `destroy` — but `when =
destroy` provisioners can't reference resource attributes that aren't
in state at destroy time (which is most of them), making the pattern
fragile. Keep the imperative scrub.

## 8. Pattern survey — other big OSS projects' deploy + Tofu

(Spot-checked — none ship a closer parallel than what we have.)

- **plausible/community-edition** — docker-compose only, no Tofu.
- **outline/outline** — single-host docker-compose recipe; no
  bootstrap dance because no separate IdP.
- **immich-app/immich** — k8s helm; bootstrap punted to k8s itself.
- **n8n-io/n8n** — same shape as outline.
- **mastodon/mastodon** `terraform/` — no IdP bootstrap, uses
  Mastodon's own user accounts.
- **supabase/supabase** — postgres bootstrap scripts are imperative
  shell; no two-phase apply.

Two-phase apply with a placeholder credential for an upstream that
the same apply provisions is rare. The closest pattern is
**zitadel/zitadel/e2e** which uses a docker-compose + sleep loop
(not a TF provider) — they sidestep the eager-Configure entirely.

## 9. Decision matrix

| Problem | Option A | Option B | Pick |
|---------|----------|----------|------|
| macOS NXDOMAIN cache | sudo flush | localhost CONNECT proxy | **B** (no sudo) |
| Cert lag past `/debug/ready` | wait longer | check issuer substring | **B** (deterministic) |
| Destroy SSH key churn | ssh-keygen -R on prior IP from BWS | ignore | **A** |
| Maintainability | leave as bash | move to Go orchestrator | **B** (test + typecheck) |
