# Secrets

> One-line purpose: where every credential in the project lives, how to
> rotate it, and what breaks when it's gone.
> **Last reviewed:** 2026-05-18 — Tailscale + GitHub PAT + CI SSH key + Tofu-managed
> GH secrets/vars + write-through CI OAuth credentials added; rotation playbook
> updated with the May-2026 zero-downtime patterns the research surfaced.

## Model

| Location | Holds | Why |
|---|---|---|
| **Bitwarden Secrets Manager** (`iedora-deploy` project) | ~16 production secrets — apps, infra bootstrap, Tofu-managed write-throughs | Single source of truth; survives laptop loss |
| `products/menu/infra/.env` (gitignored, on one laptop) | `BWS_ACCESS_TOKEN` + `BWS_PROJECT_ID` + non-secret IDs (account/zone/hostnames) | The one credential that unlocks the rest — must be on disk to bootstrap |
| `infra/tofu/terraform.tfstate` (encrypted) | `cloudflare_api_token.backups_r2` + `tailscale_federated_identity.ci` (no secret — WIF) | Cross-product shared infra; write-through to BWS via `just infra::deploy` |
| `products/menu/infra/tofu/terraform.tfstate` (encrypted) | Tunnel token + R2 sub-token (`assets_r2`) for the menu product | Created by Tofu; rotate via `tofu apply -replace=<resource>` |
| `products/house/infra/tofu/terraform.tfstate` (encrypted) | Narrow `workers_deploy` token (Workers Scripts: Write + DNS: Write + Workers Routes: Write) | Created by Tofu; write-through to BWS as `INFRA_HOUSE_WORKERS_TOKEN`; rotate via `just house::rotate-token` |
| **GitHub Actions secrets/variables** (Tofu-managed via `integrations/github`) | `BWS_ACCESS_TOKEN`, `KAMAL_SSH_PRIVATE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (secrets); `BWS_PROJECT_ID`, `ONPREM_HOST`, `MENU_PUBLIC_HOSTNAME`, `GENKAN_PUBLIC_HOSTNAME` (variables) | Drives CI deploys + the Claude Code Action; declared in `infra/tofu/github.tf`, values flow through from BWS |

`BWS_ACCESS_TOKEN` is the keys-to-the-kingdom: it unlocks every other secret. Treat it as if it were the master password.

## Token tiers — bootstrap vs workload

The Cloudflare credentials follow a two-tier pattern, deliberately:

1. **Bootstrap token** — one token, in BWS (`INFRA_CLOUDFLARE_API_TOKEN`). Categories it must hold (any new workload token's `permission_groups` is a subset of this — Cloudflare won't let a parent grant what it lacks). The current set, as of the Workers migration:

   **Account scope** (`Eduardoferdcarvalho@gmail.com's Account`):

   | Category | Why it's on the bootstrap |
   |---|---|
   | `Workers Scripts: Edit` | Granted onto `workers_deploy` (house) for asset upload. |
   | `Workers R2 Storage: Edit` | Granted onto menu's `assets_r2` and `backups_r2` sub-tokens. |
   | `Cloudflare Tunnel: Edit` | Used by menu's `tofu` to provision the tunnel + cloudflared accessory creds. |
   | `Account Settings: Read` | Various data sources / sanity reads. |

   **Zone scope** (scoped to `iedora.com` only — not wildcarded across all zones):

   | Category | Why it's on the bootstrap |
   |---|---|
   | `Workers Routes: Edit` | Granted onto `workers_deploy` so wrangler can bind the apex custom domain. |
   | `DNS: Edit` | Granted onto workload tokens that touch DNS; also used directly by menu's `tofu` for tunnel DNS records (same `iedora.com` zone serves both apex + subdomains). |

   **User scope** (`All users`):

   | Category | Why it's on the bootstrap |
   |---|---|
   | `API Tokens: Edit` | Required to create / replace / rotate every workload token resource. |

   Total: 7 permission groups. What the bootstrap **no longer needs** (vs. the Pages-era setup) — removed during the post-deploy contract phase:
   - `Cloudflare Pages: Edit` — Pages gone.
   - `Account Filter Lists: Edit` and `Account Rulesets: Edit` — the Bulk Redirect that bounced *.pages.dev → iedora.com is gone (`workers_dev = false` closes the leak directly).

   The bootstrap *has* to exist (chicken/egg — Tofu can't provision the credential it logs in with) and it *has* to be admin-ish for the categories the `.tf` files touch. The narrowing here is "permissions Tofu needs to manage *this* infra," not "all account."

2. **Workload tokens** — many, Tofu-managed, surfaced as sensitive outputs:
   - `cloudflare_api_token.assets_r2` (in `products/menu/infra/tofu/menu/`) — R2 Bucket Item Write, scoped to **one bucket** (the assets bucket). Consumed by the menu app for uploads.
   - `cloudflare_api_token.backups_r2` (in `products/menu/infra/tofu/menu/`) — R2 Bucket Item Write, scoped to **one bucket** (the backups bucket). Consumed by the backups accessory.
   - `cloudflare_api_token.workers_deploy` (in `products/house/infra/tofu/`) — Workers Scripts: Edit (account) + Workers Routes: Edit (zone) + DNS: Edit (zone). Consumed by `wrangler deploy` in `just house::deploy`. NOTE: the resource carries `lifecycle { ignore_changes = [policies] }` to work around a cloudflare/cloudflare v5 provider bug that reports policies in non-deterministic order on every refresh.

The point: **runtime tools never authenticate with the bootstrap.** If wrangler leaks a token, the worst outcome is "someone redeploys iedora.com and twiddles DNS records." If the menu app leaks its R2 token, the worst outcome is "someone overwrites objects in the assets bucket." None of those leak surfaces include "destroy the tunnel" or "mint new tokens."

**Rotation** is one resource at a time: `tofu -chdir=tofu/<root> apply -replace=cloudflare_api_token.<name>`. CF generates a new value, Tofu state captures it, the next `just <product>::deploy` picks it up via `tofu output`. The bootstrap is rotated separately in the CF dashboard.

**Adding a workload**: copy the pattern — `cloudflare_api_token "X"` resource with a narrow `permission_groups` list (the UUID is stable, found via `curl -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/permission_groups`), surface as a sensitive output, consume via `tofu output -raw` at runtime. Whatever permission groups you reference must already be on the bootstrap — if you're adding a new category (e.g. Workers KV, Hyperdrive), grant it to the bootstrap first.

## BWS secret naming

One project (`iedora-deploy`) holds every production secret. Names use a
two-prefix convention so it's obvious at a glance which subsystem owns
each key:

- **`INFRA_*`** — shared infrastructure (Tofu / Cloudflare / Postgres
  accessory / backups / GHCR). Not product-specific.
- **`MENU_*` / `GENKAN_*`** — app secrets for that one product. Each
  product has its own Better Auth instance, so each has its own
  `*_AUTH_SECRET` — separate values, separate blast radius. The BWS-key
  name describes the purpose (signs that product's session cookies); the
  fact that Better Auth happens to be the library doing the signing is an
  implementation detail kept out of the secret-management surface.

## The secrets in BWS

Organized by class (bootstrap / app / Tofu write-through) so it's clear who creates each value and who reads it.

### Bootstrap credentials — what unlocks the rest

| Key | What it does | Impact of leak | Rotation |
|---|---|---|---|
| `INFRA_CLOUDFLARE_API_TOKEN` | Master Cloudflare API token (7 permission groups across Account / Zone / User — see Token tiers) | Edit DNS, manage tunnel, write R2, push Workers, mint new tokens | Browser **Roll** (preserves token ID) → BWS edit → `just infra::deploy`. Sub-tokens survive |
| `INFRA_TAILSCALE_OAUTH_CLIENT_ID` + `_SECRET` | Tailscale OAuth client (`policy_file`+`oauth_keys`+`auth_keys`+`tag:ci`) used by the Tofu provider to manage ACL and mint the CI client | Attacker can edit tailnet ACL, mint new CI clients | Tailscale UI → generate new client → BWS edit (both halves) → `just infra::deploy` → delete old client |
| `INFRA_GITHUB_API_TOKEN` | Fine-grained PAT scoped to the iedora repo (Actions/Secrets/Variables R+W) used by the Tofu `integrations/github` provider | Attacker can push GH Actions secrets/vars, modify workflows | github.com → regenerate the existing fine-grained PAT (preserves identity) → BWS edit → `just infra::deploy` |
| `INFRA_GHCR_TOKEN` | **Classic** PAT (`write:packages`) for Kamal's `docker push` to GHCR — the documented exception to fine-grained | Attacker can push malicious images to `ghcr.io/eduvhc/{menu,genkan,iedora-backup}` | GitHub UI regenerate (or revoke + create) → BWS edit → next deploy picks up |
| `INFRA_STATE_PASSPHRASE` | Tofu state encryption (PBKDF2 + AES-GCM, 600k iterations) | Old state file in git becomes decryptable | **`fallback` block rotation** — see Zero-downtime patterns below |
| `INFRA_KAMAL_SSH_PRIVATE_KEY` | Private half of the dedicated `ci_ed25519` keypair; Tofu pushes this to GH as the `KAMAL_SSH_PRIVATE_KEY` secret for CI deploys | Attacker can SSH as root to the homelab | Generate new keypair → `ssh-copy-id` → BWS edit → `just infra::deploy` → remove old pubkey from homelab `authorized_keys` (see deploy.md § Minting the CI SSH key) |
| `BWS_ACCESS_TOKEN` (lives in `.env`, NOT in BWS itself) | The machine-account token that unlocks BWS | Attacker can read every other secret | **Blue/green** — see Zero-downtime patterns below |

### App secrets

| Key | What it does | Impact of leak | Rotation |
|---|---|---|---|
| `INFRA_POSTGRES_PASSWORD` | Postgres root + app DB password (shared accessory) | Full DB read/write for menu AND genkan | **Dual-role pattern** — see Zero-downtime patterns below. Without it: `ALTER USER` + `kamal deploy` accepts ~10s of failed-auth blips on in-flight requests |
| `INFRA_BACKUP_PASSPHRASE` | GPG passphrase for Postgres dumps in R2 | Attacker with R2 access can decrypt past dumps | **Keep old as `INFRA_BACKUP_PASSPHRASE_OLD`** when rotating; never garbage-collect until the last dump it protected has aged out of R2's lifecycle |
| `MENU_AUTH_SECRET` | Signs menu's session cookies (HMAC) | Attacker can forge menu sessions for any user | **`BETTER_AUTH_SECRETS` plural** — see Zero-downtime patterns below |
| `GENKAN_AUTH_SECRET` | Signs genkan's session cookies + JWTs | Attacker can forge genkan sessions | Same — switch to plural array; rotation becomes zero-downtime |
| `MENU_OAUTH_CLIENT_ID` + `_SECRET` | Menu's OAuth client identity at genkan | Lets attacker impersonate menu in the OAuth handshake | Register `menu-v2` at genkan with new secret → deploy menu with new id/secret pair → delete old client. Better Auth 1.6's OAuth provider doesn't yet support multi-secret on one client; new-client-then-cutover is the only path. Track upstream — `private_key_jwt` (asymmetric, no shared secret) is the better long-term answer |
| `INFRA_CLAUDE_CODE_OAUTH_TOKEN` | Claude Code Action's Pro/Max OAuth token; Tofu pushes it to GH as the `CLAUDE_CODE_OAUTH_TOKEN` secret the `.github/workflows/claude.yml` job reads | Attacker can run the Claude Code Action (code-writing runs) against the subscription | `claude setup-token` → BWS edit → `just infra::deploy`. Revoke the OAuth grant in the Anthropic account if leaked. See `docs/ai.md` |

### Tofu-managed write-throughs

These are minted by Tofu in encrypted state, then pushed to BWS by `just infra::deploy` (or product equivalents) so other systems can read from BWS without running Tofu.

| Key | Source | Rotation |
|---|---|---|
| `INFRA_CI_TAILSCALE_FEDERATED_ID` + `_AUDIENCE` | `tailscale_federated_identity.ci` (auth_keys scope, tag:ci, trusts GitHub OIDC for repo:eduvhc/iedora:*) | **No secret to rotate** — Workload Identity Federation (Tailscale GA 2026-02-19). GitHub's per-job OIDC JWT is the auth material. Resource changes via `cd infra/tofu && bin/with-secrets tofu apply -replace=tailscale_federated_identity.ci` if you ever need to alter trust claims. |
| `INFRA_HOUSE_WORKERS_TOKEN` | `cloudflare_api_token.workers_deploy` (narrow Workers + DNS perms) | `just house::rotate-token` wraps both the `-replace` and the BWS write-through atomically |

## Expand–Contract for permission / token changes

The same pattern database migrations use to rename a column without taking
the app down: **never remove the old surface in the same step that
introduces the new one**. Martin Fowler calls it [Parallel Change][];
infrastructure folks usually call it Expand–Contract or
Expand–Migrate–Contract. Three phases:

1. **Expand** — widen the surface so both the old and the new world work
   simultaneously. The system is a *superset* of what it needs to be.
2. **Migrate** — actually do the swap: deploy the new code / mint the new
   tokens / point the new DNS. Both sides remain valid during this step.
3. **Contract** — shrink the surface back down by deleting the now-unused
   legacy half.

Skipping the expand phase is the classic mistake. If you remove the old
surface *first*, the migrate step needs a permission it no longer has
(token apply) or hits a unique constraint it can't satisfy (database
rename) — and rolling back is harder than just doing the three steps.

### Worked example — the Pages → Workers bootstrap shift

Done in May 2026 when house migrated off Cloudflare Pages onto Workers
Static Assets. The bootstrap token needed `Workers Scripts: Edit` and
`Workers Routes: Edit` (new) and stopped needing `Pages: Edit`,
`Account Filter Lists: Edit`, `Account Rulesets: Edit` (old). The naive
single-edit version would have broken the cleanup apply.

| Phase | Action | What the bootstrap holds during this phase |
|---|---|---|
| **1. Expand** | Dashboard → Edit bootstrap → **add** `Workers Scripts: Edit` (account) and `Workers Routes: Edit` (zone). Leave the legacy Pages grants in place. | OLD + NEW (superset) |
| **2. Migrate** | `just house::deploy`. Tofu destroys the orphaned Pages resources (needs Pages/Filter/Ruleset grants) AND creates `workers_deploy` (needs Workers Scripts/Routes grants). Wrangler then deploys the worker + binds the apex custom domain. | OLD + NEW |
| **3. Contract** | Dashboard → Edit bootstrap → **remove** `Pages: Edit`, `Account Filter Lists: Edit`, `Account Rulesets: Edit`. | NEW only |

Each phase is independently safe: between phase 1 and phase 2 the
bootstrap holds more than it strictly needs, but nothing breaks. Between
phase 2 and phase 3 the same. Only the *transition itself* (mid-apply
with the wrong grants) would have failed, which is exactly what we're
avoiding. Two small surprises during the actual run worth recording:

- Wrangler's deploy required `Workers Routes: Edit` (not `Workers Scripts: Edit` alone) because it `GET`s `/zones/{id}/workers/routes` even when binding a custom domain. Worth adding to the workload token's policies *and* the bootstrap before phase 2 — discovered mid-apply on the live migration.
- The cloudflare/cloudflare v5 provider reports `api_token.policies` in non-deterministic order on every refresh, tripping "Provider produced inconsistent result after apply." Workaround: `lifecycle { ignore_changes = [policies] }` on the token resource (already applied in `products/house/infra/tofu/iedora.tf`). The token still works correctly in Cloudflare; Tofu just stops trying to reconcile a thing the provider can't represent stably.

### When to reach for this

Apply the same shape any time you:

- Change the permissions on a long-lived credential other tools depend on.
- Rename or replace a database column / table whose old name has live readers.
- Switch DNS targets for a hostname that has live traffic.
- Replace an environment variable that's read by multiple processes — set the
  new name, deploy the readers in waves, then drop the old name.

The cost is one extra round-trip. The benefit is you can pause or revert
at any phase boundary without leaving the system in an undefined state.

[Parallel Change]: https://www.martinfowler.com/bliki/ParallelChange.html

## "I think it leaked — what now?"

For any of the rotatable ones (everything except `INFRA_BACKUP_PASSPHRASE`):

```bash
just menu::rotate-secret MENU_AUTH_SECRET   # or whatever
```

The recipe prompts for the new value (no echo), updates BWS, and reminds you to `just menu::deploy` to roll the new value out — Kamal re-reads `.kamal/secrets` (which fetches from BWS via the `bitwarden-sm` adapter) on every deploy, so the rotated value lands in the container env on the next image swap.

For `INFRA_CLOUDFLARE_API_TOKEN` rotation: sub-tokens (tunnel + R2 + workers_deploy) are independent credentials once created by Tofu — they keep working when the master rotates. Only rotate the sub-tokens if you suspect they're individually compromised. The one-liners (paths assume you're inside `products/<product>/infra/`):

```bash
# Rotate menu's R2 sub-token (suspected R2 leak, e.g. via backup logs):
cd products/menu/infra
bin/with-secrets tofu -chdir=tofu/menu apply -replace=cloudflare_api_token.backups_r2

# Rotate menu's tunnel token (~30-60s public blip):
cd products/menu/infra
cd kamal && kamal accessory stop cloudflared && cd ..
bin/with-secrets tofu -chdir=tofu/menu apply -replace=cloudflare_zero_trust_tunnel_cloudflared.menu
cd kamal && kamal accessory reboot cloudflared

# Rotate house's wrangler deploy token (suspected leak from CI/host scrollback):
cd products/house/infra
bin/with-secrets tofu -chdir=tofu apply -replace=cloudflare_api_token.workers_deploy
cd .. && just house::deploy   # picks up the new value end-to-end
```

For `BWS_ACCESS_TOKEN` itself (the bootstrap secret):

1. Bitwarden → Secrets Manager → Machine accounts → `iedora-deploy` → Access tokens → revoke the old one
2. Generate a new access token
3. Replace `BWS_ACCESS_TOKEN=` in `products/menu/infra/.env`

No code changes — `.kamal/secrets` and `bin/with-secrets` both pull `BWS_ACCESS_TOKEN` from env at runtime.

## Expiration discipline

Cadences below blend NIST SP 800-57 Rev5 guidance with what's realistic for solo-dev iedora. Calendar reminders live in your personal task system; this table is what's reasonable, not what's mandated.

| Credential | Cadence | Reminder source |
|---|---|---|
| `INFRA_CLOUDFLARE_API_TOKEN` (bootstrap) | 90 days | Cloudflare emails 14/7/1 days before |
| `INFRA_TAILSCALE_OAUTH_CLIENT_{ID,SECRET}` (bootstrap) | Event-driven only — **no expiration by design** ([Tailscale docs](https://tailscale.com/docs/features/oauth-clients)). The CI ephemeral keys minted from it self-rotate per workflow run | n/a — Tailscale's official position is "rotate OAuth clients on suspected compromise, not on a calendar" |
| `INFRA_GITHUB_API_TOKEN` (fine-grained) | 90 days (NIST default for service-account creds) | github.com PAT expiry emails 7 days before |
| `INFRA_GHCR_TOKEN` (classic) | 1 year | GitHub emails 1 week before |
| `INFRA_KAMAL_SSH_PRIVATE_KEY` (ci_ed25519) | Annually (CIS Benchmarks for ed25519) | Manual; tie to a Q1 calendar event |
| `INFRA_STATE_PASSPHRASE` | Decades (NIST: "up to several years"); rotate on incident | Manual |
| `INFRA_POSTGRES_PASSWORD` | 90 days (PCI-DSS 8.3.9) | Manual |
| `INFRA_BACKUP_PASSPHRASE` | Annually — keep `_OLD` archived forever | Manual |
| `MENU_AUTH_SECRET`, `GENKAN_AUTH_SECRET` | Annually (with BETTER_AUTH_SECRETS plural, zero-downtime) | Manual |
| `MENU_OAUTH_CLIENT_SECRET` | Annually (OWASP ASVS v4.0 9.2) | Manual |
| `BWS_ACCESS_TOKEN` | 6–12 months — no enforced expiration | Manual; blue/green pattern below |
| Tofu-managed write-throughs (`*_CI_TAILSCALE_*`, `INFRA_HOUSE_WORKERS_TOKEN`) | Inherit from the source resource; rotate via `tofu apply -replace=` | n/a |

## Zero-downtime rotation patterns

These are the 2026-canonical recipes for rotating each credential without a service blip — sourced from each vendor's official docs + the research the agent compiled. Default to these patterns over naive "destroy-then-create" whenever a credential's value is read by a long-lived process.

### Better Auth signing secrets — plural array

Better Auth 1.5+ ships **versioned secrets** via `BETTER_AUTH_SECRETS` (plural, JSON array). First entry signs new envelopes; remaining entries decrypt-only. Rotation:

```
# In BWS, MENU_AUTH_SECRETS is now a JSON array (not the singular MENU_AUTH_SECRET):
MENU_AUTH_SECRETS=["new-secret","old-secret"]
```

Deploy → all NEW cookies/JWTs sign with `new-secret`; existing ones validate against `old-secret`. After every issued cookie has been touched once (or a deliberate session-rotation window), drop the old entry:

```
MENU_AUTH_SECRETS=["new-secret"]
```

Migration from singular: the new plural form has been supported since Better Auth 1.5 ([Better Auth options](https://better-auth.com/docs/reference/options)). Keeping the singular as a fallback for legacy data is automatic. Same shape applies to `GENKAN_AUTH_SECRETS`. This makes session-key rotation a non-event — preferred quarterly cadence over annual.

### Postgres password — dual-role pattern

Run two app roles (e.g. `menu_app` + `menu_app_rotate`) on each database. Apps connect under one at a time; rotation alternates:

1. `ALTER USER menu_app_rotate PASSWORD 'new-password'` — Postgres requires no reload; immediately live for new connections.
2. BWS edit `INFRA_POSTGRES_PASSWORD` → the value the app's DATABASE_URL now points at.
3. `just menu::deploy` — Kamal rolls the container; new container picks up the new env var.

Existing connections on the old role remain authenticated until they reconnect; no failed-auth blips. Next rotation alternates roles. See [Sheshbabu's writeup](https://www.sheshbabu.com/posts/implementing-zero-downtime-postgres-credentials-rotation-with-node-js/) for the canonical recipe.

**Single-role fallback** (what we do today): `ALTER USER` + `kamal deploy` accepts a ~10s window where the very last in-flight transactions on the old container fail with `password authentication failed`. Recoverable, not silent. Adopt dual-role when you have customers who'd notice.

### Tofu state passphrase — `fallback` block rotation

OpenTofu 1.7+ ships an encryption `fallback` mechanism that's the canonical rotation primitive. In `versions.tf`:

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

`tofu apply` reads with `old` (fallback), writes with `new`. Then on a SEPARATE commit, remove the `fallback` block and the `old` key provider — the state is now encrypted only with `new`. THEN update BWS `INFRA_STATE_PASSPHRASE` to the new value. ([OpenTofu state encryption](https://opentofu.org/docs/language/state/encryption/))

**Critical caveat:** git history of `.tfstate.encrypted` files remains decryptable with the OLD passphrase forever. Compromise of the old passphrase = treat as compromise of every secret the state ever held. Rewriting history (`git filter-branch` or BFG) is the only remediation.

### BWS access token — blue/green

The one secret that can't live in BWS (chicken-and-egg). Rotation requires two access tokens alive simultaneously:

1. Bitwarden UI → Machine accounts → `iedora-deploy` → Access tokens → **Create a SECOND token** (don't revoke the old yet).
2. Update `gh secret set BWS_ACCESS_TOKEN < <(echo "$NEW_TOKEN")` AND `products/menu/infra/.env` to the new value.
3. Push a tiny test commit / `gh workflow run menu-deploy.yml -f sha=HEAD` — verify CI authenticates with the new token.
4. Verify a local `just infra::deploy` (uses `.env`).
5. **Then** Bitwarden UI → revoke the OLD access token.

Skipping step 1 (revoke before create) makes the bootstrap unrecoverable — you'd need to re-mint everything by hand. The dual-token coexistence is supported by the Bitwarden data model; just not by tooling.

### Cloudflare API tokens — "Roll" preserves ID

Cloudflare's first-party flow for bootstrap rotation is **Roll** on the token's overview page (`POST /accounts/.../tokens/{id}/value`): same token ID, same scopes, same IP restrictions, new secret value ([Cloudflare: Roll tokens](https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/)). Tofu state for downstream resources is unaffected — they reference the bootstrap by its provider authentication, not by the secret value. After rolling: `bws secret edit INFRA_CLOUDFLARE_API_TOKEN` → done. For Tofu-managed sub-tokens (`cloudflare_api_token.*` resources), there's no Roll equivalent — use `tofu apply -replace=`.

### Tailscale CI auth — Workload Identity Federation (no rotation needed)

The Tailscale `tailscale_federated_identity.ci` resource declares trust for GitHub's OIDC issuer + the iedora repo's subject pattern. Per CI run, GHA mints a short-lived OIDC JWT (`id-token: write` permission), the `tailscale/github-action@v4` exchanges it for a short-lived Tailscale access token. **No stored secret exists to rotate.**

To change the trust scope (e.g. lock to `main` only, or add a new federated repo), edit `infra/tofu/tailscale.tf` and run `just infra::deploy`. Tailscale-side: the bootstrap OAuth client needs the `federated_keys` scope (in addition to `policy_file` + `oauth_keys` + `auth_keys`) to mint federated identities.

## Detection (more important than rotation)

Cloudflare notifications subscribed (account home → Notifications):
- **API Token Created** — disparo crítico if any new token shows up
- **API Token Deleted** — second disparo
- **Account Owner Change** — sequestro indicator
- **Two-Factor Authentication Disabled** — pre-attack pattern
- **Access Authentication Failed Events** — brute-force on dashboard login

GitHub: secret scanning is enabled by default. If you accidentally commit a token to a public repo, GitHub revokes it within minutes and emails you.

The principle: rotation is the cleanup; detection is what tells you to clean.

## The pieces that do NOT live in BWS

Configuration data — visible in DNS records or public-facing places, no security benefit to hiding:

- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` — identifiers, not credentials
- `PUBLIC_HOSTNAME` — the public URL itself
- `ONPREM_HOST` — homelab LAN IP (RFC1918)
- `GHCR_USER` — username, public

All live in `products/menu/infra/.env` next to the BWS access token.

## When designing rotation for a new credential

The mature 2026 patterns ranked by maturity:

1. **Workload Identity Federation / OIDC** (Tier 3) — preferred when the destination supports it. **In use for: GHA → GHCR (built-in `GITHUB_TOKEN`), GHA → Tailscale (`tailscale_federated_identity.ci` as of 2026-05-18).** Eliminates stored long-lived secrets entirely for those paths. Cloudflare API does not yet support OIDC from GHA — see deploy.md.
2. **Just-in-time / dynamic secrets** (Tier 2) — HashiCorp Vault or AWS IAM-auth-for-RDS. Overkill for one homelab box.
3. **Long-lived in vault + scheduled rotation** (Tier 1) — what we do. BWS + `just menu::rotate-secret`.
4. **Hardware-backed roots** (Tier 4) — only for the root credential. `BWS_ACCESS_TOKEN` could move to macOS Keychain if you specifically worry about laptop-file-read attacks.

For new secrets: default to Tier 1 unless the consumer service supports something better.
