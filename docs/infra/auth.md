# Auth — the iedora identity layer

> One-line purpose: how identity is deployed, configured, and rotated
> across iedora. Tracks the issue [#19][issue-19] migration from the
> hand-rolled Better-Auth IdP (`genkan`) to ZITADEL.
> **Last updated:** 2026-05-19.

## Shape

Identity in iedora is a **single OIDC issuer** that every product
federates to. Today (mid-migration) two issuers coexist; the target
state is one.

| | Issuer | Status | Owns |
|---|---|---|---|
| **Today** | `genkan.iedora.com` | Live, single IdP for menu | user / org / membership / OAuth-client / audit tables in the `genkan` Postgres DB |
| **Today** | `auth.iedora.com` | Live, containers up but no OIDC clients yet (#19 Phase 1 landed 2026-05-19) | nothing user-facing yet — the bootstrap admin and a single empty org |
| **Target** | `auth.iedora.com` | Sole IdP after #19 Phase 5 | every user, org, membership, OAuth client, audit event |

Phases ahead — see [issue #19][issue-19] for the full plan. Phase
status memo at `~/.claude/.../memory/project_zitadel_replaces_genkan.md`.

## Components

```
                  ┌────────────────────────────────────────┐
                  │ Cloudflare edge (TLS)                  │
                  │  auth.iedora.com → tunnel              │
                  └────────────────┬───────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │ infra-zitadel-tunnel (cloudflared)      │
              │  /ui/v2/* ─┐                            │
              │  everything else ─┐                     │
              └─────────┬─────────┼─────────────────────┘
                        │         │
                        ▼         ▼
        ┌──────────────────────┐ ┌────────────────────────────┐
        │ infra-zitadel-login  │ │ infra-zitadel              │
        │ (Next.js, :3000)     │ │ (Go binary, :8080)         │
        │ login-app v4.15.0    │ │ ghcr.io/zitadel:v4.15.0    │
        └──────────────────────┘ └──────────┬─────────────────┘
                        │                   │
                        │  PAT file         │
                        │  via shared       ▼
                        │  volume    ┌────────────────────────────┐
                        └────────────│ infra-postgres / `zitadel` │
                                     └────────────────────────────┘
```

Two containers, not one. The Go binary serves the API + Console + OIDC
endpoints; a separate Next.js container (`zitadel-login`) serves the v2
login UI (Zitadel's chosen architecture in v4 — the v1 login that used
to live in the Go binary is deprecated and only stays as a fallback for
the Console). Both run on the single homelab box; ZITADEL is ~80 MB RAM
idle, the login app ~50 MB.

### `infra-zitadel` container

Declared as `docker_container.zitadel` in `infra/tofu/containers.tf`. Key bits:

- **Image** — `ghcr.io/zitadel/zitadel:v4.15.0` (pinned exact;
  Renovate held back to manual review for the auth stack).
- **Cmd** — `start-from-init --masterkeyFromEnv --tlsMode external`.
  `start-from-init` runs migrations + seeds the default instance on
  first boot, then serves traffic. Idempotent: re-running is a no-op
  because the projection state shows the init steps already happened.
  `--tlsMode external` because Cloudflare terminates TLS at the
  tunnel edge; the kamal network sees plain HTTP. We still set
  `ZITADEL_EXTERNALSECURE=true` so generated URLs use `https://`.
- **Database** — talks to the shared `infra-postgres` (database
  `zitadel`, pre-created by `infra/postgres/init.sql` on first
  cluster init). Both the User and Admin Postgres connections reuse
  the `postgres` superuser — same convention menu and genkan follow.
- **First instance seed** — `ZITADEL_DEFAULTINSTANCE_ORG_*` envs
  create the `iedora` org, the `zitadel-admin` human user, and the
  `login-client` machine user with a 75-year PAT on the very first
  boot. The PAT is written to `/zitadel-bootstrap/login-client.pat`
  (a shared named volume — see below); `zitadel-login` reads from
  the same path.
- **LoginV2 BaseURI** — `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_BASEURI=https://auth.iedora.com/ui/v2/login`
  so the main binary's authRequest redirects target the path-routed
  tunnel rule instead of trying to serve `/ui/v2/*` itself (which
  returns `{"code":5,"message":"Not Found"}` — that's what `/ui/v2/*`
  on the Go binary looks like).

### `infra-zitadel-login` container

- **Image** — `ghcr.io/zitadel/zitadel-login:v4.15.0` (Next.js,
  pinned to the same major as the main binary — the Login app and
  the main binary share the same gRPC contracts and are released
  together).
- **Listens on `:3000`** — the tunnel routes only `/ui/v2/*` here;
  everything else stays on `infra-zitadel`.
- **Auth back to the main binary** — `ZITADEL_SERVICE_USER_TOKEN_FILE
  =/zitadel-bootstrap/login-client.pat`. The PAT belongs to the
  `login-client` machine user with the `IAM_LOGIN_CLIENT` role —
  the minimum scope that lets the login app verify sessions,
  create authRequests, and look up users without being able to
  modify identity data.
- **Shared bootstrap volume** — Docker named volume
  `zitadel-bootstrap` (declared as `docker_volume.zitadel_bootstrap`)
  mounted on both `zitadel` and `zitadel-login`.
  ZITADEL writes the PAT during FirstInstance; the login app reads
  it on every request. Loss of the volume = loss of the login app's
  ability to authenticate; recovery is the wipe-and-reinit path.

### `infra-zitadel-tunnel` container

A second `cloudflare/cloudflared` sidecar (the first one serves
`obs.iedora.com`). Separate tunnel resource — different blast radius,
independent rotation. Connector token flows straight from
`module.zitadel_tunnel.token` (Tofu output) into the container's
`command = ["tunnel", "--no-autoupdate", "run", "--token", ...]` —
no intermediate secrets file, no ERB hop.

### `auth.iedora.com` tunnel

`module.zitadel_tunnel` in `infra/tofu/main.tf` — same shared
`cloudflare-tunnel-app` module the observability tunnel uses, with
a path-routing override:

```hcl
primary_service = "http://infra-zitadel:8080"     # everything else
path_routes = [
  { path = "/ui/v2/.*", service = "http://infra-zitadel-login:3000" },
]
```

The `path_routes` slot was added to the module specifically for
this — cloudflared's ingress is first-match, so path-prefix rules
MUST come before the catch-all primary or every request goes to the
Go binary first. Tunnel name: `iedora-zitadel`.

### `zitadel` database

Sibling to `menu` and `genkan` in `infra/postgres/init.sql`. Daily
`pg_dumpall` covers it automatically (the `infra-backups` container
dumps every database on the cluster). After Phase 5, the `genkan`
database gets dropped.

### `zitadel-bootstrap` named volume

Docker named volume created by `docker_volume.zitadel_bootstrap` in
`infra/tofu/containers.tf`. Both `infra-zitadel` and `infra-zitadel-login`
mount it at `/zitadel-bootstrap`. Holds exactly one file:
`login-client.pat` — the PAT Zitadel writes during FirstInstance and
the login app reads on every flow.

**Permissions quirk** — Zitadel runs as the non-root `zitadel` user
(UID 1000), `zitadel-login` as `nextjs` (UID 1001). Docker creates
named volumes as `root:root 755` by default, which means neither
user can write. A one-shot init container
(`docker_container.zitadel_bootstrap_chmod`, busybox `chmod 777 /x`)
runs once at create time and exits; the main zitadel container has
a `depends_on` to it so the chmod always wins the race. The volume
is namespace-isolated to these two containers, so 777 isn't a real
surface area increase. Symptom of a missing chmod (don't ask how I
know): Zitadel logs `open /zitadel-bootstrap/login-client.pat:
permission denied`, followed by `unique_constraints_pkey` violations
on retry because the half-completed FirstInstance step leaves rows
behind.

## Secrets

All in BWS, project `iedora-deploy`. Two new for Phase 1:

| Key | Length / format | What it does | Rotation |
|---|---|---|---|
| `INFRA_ZITADEL_MASTERKEY` | **exactly 32 ASCII chars** | Encrypts every internal Zitadel secret (signing keys, OAuth client secrets, action target keys) | **Do not rotate casually.** Re-keying requires a documented multi-step flow with downtime. Generate once at bootstrap via `openssl rand -base64 24 \| head -c 32` |
| `INFRA_ZITADEL_FIRST_ADMIN_PASSWORD` | strong; mix of upper/lower/digit/symbol | Seeds the `zitadel-admin` human user **on the first boot only** | Rotate the live password via the Zitadel UI — this BWS entry is ignored on subsequent boots |

Reused (no new BWS entries needed):

- `INFRA_POSTGRES_PASSWORD` — the `infra-postgres` superuser; serves
  Zitadel's User and Admin DB connections.

Tofu-managed write-throughs (will exist after Phase 1.5):

- `INFRA_ZITADEL_SA_KEY_JSON` — JSON service-account key for the
  Terraform provider. **Cannot be created by Tofu** (chicken-and-egg
  — the provider needs it to authenticate). One-time manual mint
  after the first deploy; see Bootstrap below.

Full rotation guidance: [`docs/secrets.md`](../secrets.md) §
App secrets.

## Bootstrap (first-time-only flow)

After the infra code changes from #19 Phase 1 land:

1. **Mint the BWS secrets** (already done 2026-05-19, kept for
   reproducibility):

   ```sh
   # masterkey — EXACTLY 32 chars
   openssl rand -base64 24 | head -c 32
   # first-admin password — ≥ 8 chars, mix of upper/lower/digit/symbol
   PW=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24); printf '%s!9Aa\n' "$PW"

   # Push to BWS (project iedora-deploy)
   bws secret create -o none -- INFRA_ZITADEL_MASTERKEY              "<32-char value>"      "$BWS_PROJECT_ID"
   bws secret create -o none -- INFRA_ZITADEL_FIRST_ADMIN_PASSWORD   '<strong password>'    "$BWS_PROJECT_ID"
   ```

2. **Deploy** — `just infra::deploy` runs one `tofu apply` that does
   everything in order via `depends_on` and the docker provider's
   create/start semantics:
   - Cloudflare resources land (R2 buckets, both tunnels, DNS records).
   - `docker_network.kamal` + `docker_volume.zitadel_bootstrap` come up
     (the volume's `local-exec` provisioner chmods it 777 so non-root
     container users can write).
   - `docker_container.postgres` boots; init.sql is auto-uploaded and
     runs the `CREATE DATABASE` statements on a brand-new cluster.
   - `docker_container.zitadel` boots; `start-from-init` migrates the
     empty `zitadel` Postgres database, creates the `iedora` org, the
     `zitadel-admin` human user with the bootstrap password, and the
     `login-client` machine user with a 75-year PAT. The PAT is
     written to `/zitadel-bootstrap/login-client.pat`.
   - `docker_container.zitadel_login` boots; reads the PAT from the
     shared volume and starts serving `/ui/v2/login/*` on `:3000`.
   - `docker_container.zitadel_tunnel` boots; cloudflared dials out to
     Cloudflare with the token from `module.zitadel_tunnel.token`.
     `auth.iedora.com` resolves end-to-end with the path-routing rules
     from `module.zitadel_tunnel.path_routes`.

3. **Mint the service-account key for Terraform** — one-shot, manual,
   in the Zitadel UI:
   - Log in to `https://auth.iedora.com/ui/v2/login` with the
     `zitadel-admin` user and the bootstrap password from BWS.
     Change the password on first login.
   - Settings → Service Users → New → role `IAM_OWNER`.
   - On the service user, Keys → Add → Type = JSON. Download the
     `.json` file.
   - Push to BWS as a single multiline secret:

     ```sh
     bws secret create -o none -- INFRA_ZITADEL_SA_KEY_JSON "$(cat ~/Downloads/sa-key.json)" "$BWS_PROJECT_ID"
     ```

4. **Declare the IdP shape in Tofu** (Phase 1.5) — `infra/tofu/zitadel.tf`
   gets the `zitadel/zitadel` provider block + the first declarative
   resources (`zitadel_org.iedora`, `zitadel_project.iedora`). From
   this point on, every OAuth client and policy iedora ever needs is
   HCL-declared, never UI-clicked. Honors `infra/CLAUDE.md` hard
   rule #1 (declarative-first).

### Re-bootstrap (wipe-and-redo)

The `login-client` PAT is written ONLY during FirstInstance — once
the `zitadel` database has any events, the FirstInstance step is
skipped on subsequent `start-from-init` runs. Symptoms when this
goes wrong: HTTP 502 on `/ui/v2/login/*` (login app blocked
"Awaiting file") or repeating `Errors.Instance.Domain.AlreadyExists`
in zitadel logs (FirstInstance crashed mid-way leaving the unique
constraint behind). Recovery:

```sh
# 1. Stop the two containers that touch the volume.
ssh root@$ONPREM_HOST 'docker stop infra-zitadel-login infra-zitadel'

# 2. Drop + recreate the zitadel database (menu + genkan untouched).
ssh root@$ONPREM_HOST 'docker exec infra-postgres psql -U postgres \
  -c "DROP DATABASE zitadel;" -c "CREATE DATABASE zitadel;"'

# 3. Re-chmod the bootstrap volume (in case it was newly created)
#    AND ensure no stale PAT file lingers.
ssh root@$ONPREM_HOST 'docker run --rm -v zitadel-bootstrap:/x busybox \
  sh -c "rm -f /x/login-client.pat && chmod 777 /x"'

# 4. Start zitadel — FirstInstance reruns and writes a fresh PAT.
ssh root@$ONPREM_HOST 'docker start infra-zitadel'

# 5. Wait for the PAT to land, then start the login app.
until ssh root@$ONPREM_HOST 'docker run --rm -v zitadel-bootstrap:/x busybox test -s /x/login-client.pat'; do sleep 3; done
ssh root@$ONPREM_HOST 'docker start infra-zitadel-login'
```

There's no usable data to preserve until at least one product
federates through Zitadel (Phase 3+), so this is cheap during the
migration window.

**Common gotcha** — Zitadel splits its config across two viper
namespaces. The Console UI defaults (`ZITADEL_DEFAULTINSTANCE_*`)
DO NOT reach the FirstInstance step; that step reads from a separate
setup viper using `ZITADEL_FIRSTINSTANCE_*`. The Go source override
sits at `cmd/setup/03.go: mig.instanceSetup.Org = mig.Org`. Using
the wrong prefix is silent — the human admin and login-client fall
back to steps.yaml defaults (`zitadel-admin@zitadel.<domain>` with
password `Password1!`) and you wonder why your BWS credentials
don't work.

## Day-2 operations

```sh
# Tail logs (any infra-* container; `just infra::logs zitadel` etc.).
just infra::logs zitadel

# Drop into the Zitadel container — debug only; image has no shell,
# so use `docker exec` against the binary directly if you need a one-shot.
ssh root@$ONPREM_HOST 'docker exec infra-zitadel /zitadel --help'

# psql into the zitadel database.
just infra::console        # then: \c zitadel

# Reboot zitadel (e.g. to pick up a rotated INFRA_POSTGRES_PASSWORD).
ssh root@$ONPREM_HOST 'docker restart infra-zitadel infra-zitadel-login'

# Rotate the operator login password (NOT the masterkey).
# → log in to auth.iedora.com → Profile → Password
```

Zitadel + its tunnel reboot independently of the menu app — `docker
restart` works without disturbing other containers on the `kamal`
Docker network. No app redeploy is needed because no product currently
federates to Zitadel — that lands in Phase 3.

## OIDC client integration (forward-looking)

Once Phase 1.5 declares `zitadel_application_oidc.<product>` in Tofu,
each product gets a client_id + client_secret as Tofu outputs. The
write-through pattern from `infra/CLAUDE.md` hard rule #2 applies:
Tofu mints the credentials, the `just infra::deploy` recipe pushes
them to BWS, the product reads them from BWS via its own
`bin/with-secrets`.

For non-OIDC services (OpenObserve OSS in particular), an
`oauth2-proxy` accessory will sit between the tunnel and the
upstream. That replaces the Cloudflare Access workaround from #13.
Phase 2 of #19.

## See also

- **[issue #19][issue-19]** — full migration plan, every phase's
  acceptance criteria, the resource shapes verified against
  `zitadel/zitadel@2.12.7`.
- **[issue #13][issue-13]** — Cloudflare Access redirect-loop bug
  whose root cause was "OpenObserve OSS doesn't speak OIDC"; Phase 2
  of #19 closes it properly via oauth2-proxy.
- **[`docs/secrets.md`](../secrets.md)** — every BWS key, rotation
  cadence, zero-downtime patterns. The two new Zitadel secrets are
  listed there.
- **[`docs/deploy.md`](../deploy.md)** — overall deploy flow;
  `just infra::deploy` runs one `tofu apply` that brings up the
  auth.iedora.com tunnel + the Zitadel containers in the right order.
- **[`infra/CLAUDE.md`](../../infra/CLAUDE.md)** — what the shared
  `infra/` workspace owns, the six hard rules (declarative-first,
  Tofu write-through, bootstrap order, Terraform style, encrypted
  state, one root per blast-radius unit).
- **[`docs/architecture.md`](../architecture.md)** — vertical-slice
  layout in each product. `src/features/identity/` is where the
  per-product Zitadel HTTP adapter will live after Phase 4.

[issue-19]: https://github.com/eduvhc/iedora/issues/19
[issue-13]: https://github.com/eduvhc/iedora/issues/13
