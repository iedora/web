# Dev — `just dev` boots the whole stack locally

One command, one declarative source. `just dev` runs OpenTofu against `infra/dev/tofu/`, which calls the same `infra/modules/services/*` modules prod uses — same image shapes, same env contract, just pointed at a local Docker daemon. No `docker-compose`.

```
local docker daemon
  ├─ infra-postgres        :5432   (shared by menu + zitadel DBs)
  ├─ infra-localstack      :4566   (S3 mock — iedora-data + iedora-assets buckets)
  ├─ infra-openobserve     :5080   (OTLP/HTTP ingest; cold tier → localstack)
  ├─ infra-zitadel         :8080   (auth — always-on plumbing)
  ├─ infra-zitadel-login   :3001   (login UI)
  ├─ infra-house           :3002   (Astro static, busybox httpd)
  └─ infra-menu-web        :3000   (Next.js — same image as prod)
```

The orchestrator (`infra/dev/`, Go) does a 4-step Tofu choreography: init → targeted apply (containers up) → wait for Zitadel `/debug/ready` → seed apply (OIDC client, PATs, `.env` files).

---

## Quickstart

```bash
just dev               # bring everything up (~30s cold, ~5s warm)
just dev-down          # tear down + wipe volumes / state / .env.local
```

That's it for the golden path. Zero env vars to set, no `BWS_ACCESS_TOKEN` needed (BWS only kicks in for prod). The first apply builds the menu + house images from source.

---

## Flags

```bash
just dev -i                          # interactive TUI per category
just dev --only menu                 # menu + its deps (postgres + localstack + openobserve)
just dev --except openobserve        # everything else; openobserve stays off
```

| Flag | Effect |
|---|---|
| `-i`, `--interactive` | per-category multi-select (huh TUI); start everything pre-checked, deselect what you don't want |
| `--only X,Y` | bring up only X, Y, and their transitive deps |
| `--except X,Y` | bring up everything except X, Y; their env keys go to `.env.local` as `<please_fill>` for manual override |

`--only` and `--except` are mutually exclusive. Both close over the dep graph: `--only menu` boots postgres + localstack + openobserve too, since menu needs them.

**Zitadel is always-on.** It's not in the selection list — menu has no auth path that bypasses it, and the seed phase that mints OIDC client_id/secret can't run without a live local Zitadel. The TF gate `var.enable_zitadel` exists for CI scenarios that test other services in isolation, but the CLI doesn't expose it.

---

## Menu container vs `bun run dev`

The default path runs menu in a container — same image as prod (`iedora-menu:dev`), no HMR. Good for full-stack debugging.

For HMR, opt menu out and run it host-side:

```bash
just dev --except menu               # infra up, menu stays down
cd products/menu && bun run dev      # Next.js dev server on :3000
```

Tofu emits two `.env` variants for this — the container variant uses docker-network DNS (`infra-postgres:5432`), the host variant uses `localhost:<published_port>`. The host variant is what gets written to `products/menu/.env` when menu is `--except`'d.

---

## `.env` / `.env.local` model

Two files, two roles:

**`products/menu/.env`** — committed, TF-owned. Auto-rewritten every `just dev`. Every key has a real value (the random ones are regenerated on `just dev-down` + `just dev`; safe to commit since they only unlock the operator's own localhost stack).

**`products/menu/.env.local`** — gitignored, operator-owned. `.env.local` overrides `.env` for `bun run dev`. The orchestrator schema-syncs it:

- Missing keys (for `--except`'d services) → filled with `<please_fill>`. You paste the real value (e.g. homelab tunnel URL, remote endpoint).
- Existing `<please_fill>` placeholder → auto-refilled with TF value if the service comes back online.
- Existing real value → preserved verbatim. The orchestrator never overwrites operator input.

Before every apply, a warning surfaces shadowing overrides so you notice before `bun run dev` pulls unexpected URLs.

---

## Tear-down

```bash
just dev-down
```

Wipes containers, network, volumes, the Zitadel bootstrap dir, the Tofu state, and `products/menu/.env.local`. Everything regenerates on the next `just dev` — fresh PATs, fresh Zitadel DB, fresh OIDC client secret.

`just dev-down` is best-effort (each step prefixed `-` so failures don't cascade) — safe to run from any partial state.

---

## Common pitfalls

- **Port 8080 busy.** Zitadel publishes on `:8080`. If something else (another local Zitadel, a Jenkins, anything) holds it, the apply fails. Free the port or stop the conflicting service.
- **First apply takes ~30s.** Image builds for menu + house run in parallel during pass 1. Warm reboots (volumes preserved) finish in ~5s.
- **`.env.local` shadowing a TF value.** The pre-apply warning will name the keys. If unintended, delete the line in `.env.local` and re-run.
- **Stale Zitadel state.** If you change the masterkey or the bootstrap dir gets corrupted, `just dev-down` is the reset hammer.

---

## Internals

The orchestrator is one Go package at `infra/dev/`, split by concern:

| File | Owns |
|---|---|
| `dev.go` | `main()` + the 4-step apply choreography |
| `consts.go` | magic strings / paths / timing |
| `service.go` | service catalog + dep graph |
| `selection.go` | CLI flags + TUI |
| `envfile.go` | `.env` + `.env.local` lifecycle |
| `proc.go` | exec / wait / log helpers |

Waits use TCP-dial + HTTP probe (`net.DialTimeout` then `http.Get`) instead of `time.Sleep` polling — typical detect time is ~50ms past the moment Zitadel actually starts answering `/debug/ready`.

State lives at `infra/dev/tofu/terraform.tfstate` (plaintext, gitignored). Throwaway — `just dev-down` wipes it.
