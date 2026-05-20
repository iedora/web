# Secrets

Where every credential lives, how to rotate it, what breaks when it's gone.

## Model

| Location | Holds | Why |
|---|---|---|
| **Bitwarden Secrets Manager** (`iedora-deploy` project) | Every production secret | Single source of truth; survives laptop loss |
| `infra/.env` (gitignored, local) | `BWS_ACCESS_TOKEN` + non-secret IDs (account/zone/hostnames) | The one credential that unlocks the rest — must be on disk to bootstrap |
| `infra/tofu/terraform.tfstate` (encrypted) | Tofu-minted credentials (R2 sub-tokens, GH config write-throughs) | Cross-product shared infra |
| `products/menu/infra/tofu/terraform.tfstate` (encrypted) | R2 assets bucket token | Menu's product-local resources |
| `products/house/infra/tofu/terraform.tfstate` (encrypted) | Narrow `workers_deploy` token | House's product-local resources |
| **GitHub Actions secrets/variables** (Tofu-managed) | `BWS_ACCESS_TOKEN`, `INFRA_KAMAL_SSH_PRIVATE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (secrets); `BWS_PROJECT_ID`, `ONPREM_HOST`, `MENU_PUBLIC_HOSTNAME`, `CLOUDFLARE_ACCOUNT_ID`, `GHCR_USER` (variables) | Drives `infra-deploy` workflow + Claude Code Action; declared in `infra/tofu/github.tf`, values flow from BWS |

`BWS_ACCESS_TOKEN` is the keys-to-the-kingdom: it unlocks every other secret.

> **Tombstone name.** `INFRA_KAMAL_SSH_PRIVATE_KEY` is kept verbatim across BWS, GH Actions, and the `kreuzwerker/docker` provider — load-bearing across rotation playbooks. Don't rename.

## Token tiers — bootstrap vs workload

Cloudflare credentials follow a two-tier pattern, deliberately:

1. **Bootstrap token** — one, in BWS as `INFRA_CLOUDFLARE_API_TOKEN`. Categories it must hold (any workload token's `permission_groups` is a subset — Cloudflare won't let a parent grant what it lacks):

   **Account scope** (`Eduardoferdcarvalho@gmail.com's Account`):
   - `Workers Scripts: Edit` — granted onto `workers_deploy` (house).
   - `Workers R2 Storage: Edit` — granted onto menu's `assets_r2`, `backups_r2`, `observability_r2`.
   - `Account Settings: Read` — data-source reads.

   **Zone scope** (scoped to `iedora.com`):
   - `Workers Routes: Edit` — granted onto `workers_deploy` for apex custom domain.
   - `DNS: Edit` — for the DNS records iedora.com hosts (menu/auth/obs A records + assets custom domain).

   **User scope**:
   - `API Tokens: Edit` — required to create / rotate workload tokens.

   Total: 6 permission groups.

2. **Workload tokens** — many, Tofu-managed, surfaced as sensitive outputs:
   - `cloudflare_api_token.assets_r2` (menu-local root) — R2 Bucket Item Write, scoped to one bucket.
   - `cloudflare_api_token.backups_r2` (shared infra) — R2 Bucket Item Write, scoped to backups bucket.
   - `cloudflare_api_token.observability_r2` (shared infra) — R2 Bucket Item Write, scoped to observability bucket.
   - `cloudflare_api_token.workers_deploy` (house-local) — Workers Scripts + Routes + DNS. Carries `lifecycle { ignore_changes = [policies] }` (cloudflare/cloudflare v5 reports policies in non-deterministic order on refresh).

**Runtime tools never authenticate with the bootstrap.** Workload-token leak = bounded impact (one bucket, or one product's wrangler deploys). No leak surface includes "destroy the tunnel" or "mint new tokens."

**Rotation** is per-resource: `tofu apply -replace=cloudflare_api_token.<name>`. CF generates a new value, Tofu state captures it, the next `just <product>::deploy` picks it up via `tofu output`. Bootstrap rotates separately in the CF dashboard.

**Adding a workload**: copy the pattern — `cloudflare_api_token "X"` with a narrow `permission_groups` list (UUIDs found via `curl -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/permission_groups`), sensitive output, consume via `tofu output -raw`. Any new permission group must be on the bootstrap first.

## BWS naming convention

- **`INFRA_*`** — shared infrastructure (Tofu / Cloudflare / Postgres / backups / GHCR / Zitadel).
- **`MENU_*`** — menu-product secrets.

## The secrets in BWS

### Bootstrap credentials

| Key | Purpose | Impact of leak | Rotation |
|---|---|---|---|
| `INFRA_CLOUDFLARE_API_TOKEN` | Master CF token (6 permission groups) | Edit DNS, write R2, push Workers, mint new tokens | Browser **Roll** (preserves token ID) → BWS edit → `just infra::deploy`. Sub-tokens survive |
| `INFRA_HCLOUD_TOKEN` | Hetzner Cloud API token (R/W) | Attacker can create/destroy VPSes on your account | Hetzner console regenerate → BWS edit. New VPS provisioning needs it; running stack is unaffected |
| `INFRA_GITHUB_API_TOKEN` | Fine-grained PAT (Actions/Secrets/Variables R+W) | Attacker can push GH Actions secrets, modify workflows | github.com regenerate (preserves identity) → BWS edit → `just infra::deploy` |
| `INFRA_GHCR_TOKEN` | Classic PAT (`write:packages`) for CI's `docker push` AND Tofu's pull on the box | Attacker can push malicious images to `ghcr.io/eduvhc/menu` | GH UI regenerate → BWS edit → next deploy picks up |
| `INFRA_STATE_PASSPHRASE` | Tofu state encryption (PBKDF2 + AES-GCM, 600k iterations) | Old encrypted state in git becomes decryptable | **`fallback` block rotation** — see below |
| `INFRA_KAMAL_SSH_PRIVATE_KEY` | Private SSH key Tofu uses to reach the Hetzner Docker daemon. Tofu pushes it to GH as `INFRA_KAMAL_SSH_PRIVATE_KEY`. Name is a tombstone | SSH as root to the VPS | Generate new keypair → `ssh-copy-id root@$(infra-output hetzner_ipv4)` → BWS edit → `just infra::deploy` → remove old pubkey from `/root/.ssh/authorized_keys` |
| `BWS_ACCESS_TOKEN` (in `infra/.env`, NOT in BWS) | Unlocks BWS itself | Read every other secret | **Blue/green** — see below |

### App secrets

| Key | Purpose | Impact of leak | Rotation |
|---|---|---|---|
| `INFRA_POSTGRES_PASSWORD` | Postgres root + app DB password | Full DB read/write for menu + zitadel | **Dual-role pattern** — see below. Without it: ~5–10s window where in-flight transactions on the old container fail |
| `INFRA_BACKUP_PASSPHRASE` | GPG passphrase for Postgres dumps in R2 | Attacker with R2 access can decrypt past dumps | **Keep old as `INFRA_BACKUP_PASSPHRASE_OLD`** when rotating; never GC until the last dump it protected has aged out of R2 lifecycle |
| `INFRA_ZITADEL_MASTERKEY` | 32-char masterkey encrypting Zitadel's internal secrets (signing keys, OAuth client secrets) | Attacker can decrypt the projection table | **Do NOT rotate casually.** Documented re-key flow only. Generate once via `openssl rand -base64 24 \| head -c 32` |
| `INFRA_ZITADEL_FIRST_ADMIN_PASSWORD` | Bootstrap password for the `zitadel-admin` user on FIRST boot | Attacker who reaches `auth.iedora.com` with this gets `IAM_OWNER` | Rotate the live password in Zitadel UI — this BWS entry is only honored on the very first init |
| `INFRA_OPENOBSERVE_ROOT_USER_PASSWORD` | OpenObserve admin login | Attacker can read every trace + metric | Rotate in OpenObserve UI; redeploy each product so the ingest header in env updates |
| `MENU_AUTH_SECRET` | Signs menu's session cookies (HMAC) | Forge menu sessions | **`BETTER_AUTH_SECRETS` plural** — see below |
| `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | Claude Code Action's Pro/Max OAuth token; Tofu pushes to GH as `CLAUDE_CODE_OAUTH_TOKEN` | Attacker can run the Action against your subscription | `claude setup-token` → BWS edit → `just infra::deploy`. Revoke in Anthropic account if leaked. See `docs/ai.md` |

### Tofu-managed write-throughs

Minted by Tofu in encrypted state, pushed to BWS by `just infra::deploy` so other systems can read from BWS without running Tofu.

| Key | Source | Rotation |
|---|---|---|
| `INFRA_HOUSE_WORKERS_TOKEN` | `cloudflare_api_token.workers_deploy` | `just house::rotate-token` (atomic `-replace` + BWS write-through) |

## Expand–Contract for permission / token changes

The same pattern DB migrations use to rename a column without taking the app down: **never remove the old surface in the same step that introduces the new one**.

1. **Expand** — widen the surface so both old and new work simultaneously (superset).
2. **Migrate** — actually do the swap; both sides remain valid.
3. **Contract** — shrink back down by deleting the legacy half.

Skipping expand is the classic mistake. If you remove the old surface first, the migrate step needs a permission it no longer has (token apply) or hits a unique constraint it can't satisfy (DB rename).

Apply this shape whenever you:
- Change permissions on a long-lived credential.
- Rename or replace a DB column/table with live readers.
- Switch DNS targets for a hostname with live traffic.
- Replace an env var read by multiple processes.

Cost: one extra round-trip. Benefit: pause/revert at any phase boundary without leaving the system undefined.

[Parallel Change reference](https://www.martinfowler.com/bliki/ParallelChange.html).

## "I think it leaked — what now?"

For most secrets:

```bash
just infra::rotate-secret MENU_AUTH_SECRET   # or whatever
```

Prompts for new value (no echo), updates BWS, reminds you to `just infra::deploy`. `bin/with-secrets` re-reads BWS on every apply.

For `INFRA_CLOUDFLARE_API_TOKEN` rotation: sub-tokens are independent credentials, they keep working when the master rotates. Only rotate sub-tokens if individually compromised:

```bash
# Rotate a specific sub-token:
cd products/menu/infra
bin/with-secrets tofu -chdir=tofu apply -replace=cloudflare_api_token.assets_r2

cd infra
bin/with-secrets tofu -chdir=tofu apply -replace=cloudflare_api_token.backups_r2
bin/with-secrets tofu -chdir=tofu apply -replace=cloudflare_api_token.observability_r2
```

For `BWS_ACCESS_TOKEN`:
1. Bitwarden UI → Machine accounts → `iedora-deploy` → Access tokens → revoke old
2. Generate new
3. Replace `BWS_ACCESS_TOKEN=` in `infra/.env`

No code changes — `bin/with-secrets` reads it at runtime.

## Expiration discipline

| Credential | Cadence | Reminder source |
|---|---|---|
| `INFRA_CLOUDFLARE_API_TOKEN` (bootstrap) | 90 days | Cloudflare emails 14/7/1 days before |
| `INFRA_HCLOUD_TOKEN` | Annually | Manual |
| `INFRA_GITHUB_API_TOKEN` (fine-grained) | 90 days | github.com expiry emails 7 days before |
| `INFRA_GHCR_TOKEN` (classic) | 1 year | GitHub emails 1 week before |
| `INFRA_KAMAL_SSH_PRIVATE_KEY` | Annually (CIS for ed25519) | Manual; Q1 calendar event |
| `INFRA_STATE_PASSPHRASE` | Decades (NIST: "up to several years"); rotate on incident | Manual |
| `INFRA_POSTGRES_PASSWORD` | 90 days (PCI-DSS 8.3.9) | Manual |
| `INFRA_BACKUP_PASSPHRASE` | Annually — archive `_OLD` forever | Manual |
| `MENU_AUTH_SECRET` | Annually (with `BETTER_AUTH_SECRETS` plural, zero-downtime) | Manual |
| `BWS_ACCESS_TOKEN` | 6–12 months | Manual; blue/green |
| Tofu write-throughs (`INFRA_HOUSE_WORKERS_TOKEN`) | Inherit from source; rotate via `tofu apply -replace=` | n/a |

## Zero-downtime rotation patterns

### Better Auth signing secrets — plural array

Better Auth 1.5+ ships **versioned secrets** via `BETTER_AUTH_SECRETS` (JSON array). First entry signs new envelopes; remaining decrypt-only:

```
MENU_AUTH_SECRETS=["new-secret","old-secret"]
```

Deploy → all NEW cookies sign with `new-secret`; existing ones validate against `old-secret`. After every issued cookie has been touched once, drop the old:

```
MENU_AUTH_SECRETS=["new-secret"]
```

The singular `MENU_AUTH_SECRET` stays as automatic fallback. ([Better Auth options](https://better-auth.com/docs/reference/options).)

### Postgres password — dual-role pattern

Run two app roles (`menu_app` + `menu_app_rotate`); apps connect under one at a time; rotation alternates:

1. `ALTER USER menu_app_rotate PASSWORD 'new-password'` — immediately live for new connections.
2. BWS edit `INFRA_POSTGRES_PASSWORD` → what the app's DATABASE_URL points at.
3. `just infra::deploy` — Tofu recreates `docker_container.menu_web` with the new env.

Existing connections on the old role remain authenticated until they reconnect; no blips.

**Single-role fallback** (what we do today): `ALTER USER` + `just infra::deploy` accepts a ~5–10s window where the last in-flight transactions fail with `password authentication failed`. Adopt dual-role when customers would notice.

### Tofu state passphrase — `fallback` block rotation

In `versions.tf`:

```hcl
encryption {
  key_provider "pbkdf2" "default" { passphrase = var.state_passphrase_new }
  key_provider "pbkdf2" "old"     { passphrase = var.state_passphrase_old }
  method "aes_gcm" "new" { keys = key_provider.pbkdf2.default }
  method "aes_gcm" "old" { keys = key_provider.pbkdf2.old }
  state {
    method = method.aes_gcm.new
    fallback { method = method.aes_gcm.old }
  }
}
```

`tofu apply` reads with `old` (fallback), writes with `new`. Then on a SEPARATE commit, remove the `fallback` block and the `old` provider. THEN update BWS to the new value.

**Critical caveat:** git history of `.tfstate.encrypted` files remains decryptable with the OLD passphrase forever. Compromise of the old = treat as compromise of every secret the state ever held. Rewriting history (`git filter-branch` or BFG) is the only remediation.

### BWS access token — blue/green

1. Bitwarden UI → Machine accounts → `iedora-deploy` → Access tokens → **Create a SECOND token** (don't revoke yet).
2. Update `infra/.env` to new value, `just infra::deploy` (write-throughs to GH).
3. `gh workflow run infra-deploy.yml` — verify CI authenticates.
4. **Then** revoke the OLD token.

Skipping step 1 makes the bootstrap unrecoverable.

### Cloudflare API tokens — "Roll" preserves ID

`POST /accounts/.../tokens/{id}/value`: same token ID, same scopes, same IP restrictions, new value ([CF docs](https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/)). Downstream Tofu state is unaffected. After rolling: `bws secret edit INFRA_CLOUDFLARE_API_TOKEN`. For Tofu-managed sub-tokens, no Roll equivalent — use `tofu apply -replace=`.

## Detection (more important than rotation)

Cloudflare notifications subscribed:
- **API Token Created / Deleted**
- **Account Owner Change**
- **Two-Factor Authentication Disabled**
- **Access Authentication Failed Events**

GitHub: secret scanning is enabled by default. If you accidentally commit a token to a public repo, GitHub revokes it within minutes.

## Not in BWS

Configuration data (no security benefit to hiding):

- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` — identifiers, not credentials.
- `GHCR_USER` — public username.

These live in `infra/.env`.

`ONPREM_HOST` (Hetzner public IPv4) is write-through to BWS as `INFRA_ONPREM_HOST` by `just infra::deploy` — survives a box reprovision.

## When designing rotation for a new credential

Ranked by maturity:

1. **Workload Identity Federation / OIDC** — preferred when destination supports it. **Used for GHA → GHCR** (built-in `GITHUB_TOKEN`). CF API does not yet support OIDC from GHA.
2. **Just-in-time / dynamic secrets** — Vault, AWS IAM-auth-for-RDS. Overkill for one VPS.
3. **Long-lived in vault + scheduled rotation** — what we do. BWS + `just infra::rotate-secret`.
4. **Hardware-backed roots** — only for root credentials. `BWS_ACCESS_TOKEN` could move to macOS Keychain if laptop-file-read attacks become a worry.

Default to tier 3 unless the consumer service supports something better.
