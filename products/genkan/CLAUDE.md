# Genkan — `products/genkan/`

Genkan-specific hard rules, file layout, and commands. The root `AGENTS.md` covers cross-cutting conventions (stack, slice pattern, CI, repo-root commands). Claude Code auto-loads both when working under this subtree.

Genkan is the iedora IdP (genkan.iedora.com). Better Auth + `@better-auth/oauth-provider` + the `organization` and `admin` plugins. Owns the canonical user, session, organization, membership, OAuth-client, audit-log and webhook-subscription tables. Every other product authenticates through genkan via OIDC; every product receives identity events via signed webhooks. "Genkan" is Japanese for the entryway of a house — the room you pass through to get inside.

Genkan reuses the same slice shape as menu, so menu's rules about ports / use-cases / adapters / barrels (menu's rules 2, 3, 5, 14) apply verbatim here. The rules below are the extra constraints specific to running the IdP.

## Hard rules — Genkan

1. **Tenant scoping in genkan is two-tier.** `/admin/*` requires
   `requireAdmin()` (reads `user.role === 'admin'` from the user row
   — the field is `input: false` so public sign-up cannot set it,
   pinned by `src/features/auth/__tests__/role-escalation.test.ts`).
   Tenant-scoped reads outside admin use
   `requireActiveOrganization()`. Both live in
   `src/features/auth/use-cases/`; `requireAdmin` is in
   `src/features/admin/use-cases/require-admin.ts`. Layouts don't
   guard — the DAL does. Same lesson as menu rule 3.

2. **Audit chain integrity is enforced via a Postgres advisory
   lock.** Every `record()` call serialises through
   `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY = 1224391960)` so the
   chain (`prev_hash → row_hash`) is tamper-evident even when N
   admin requests interleave. The hash covers a fixed field order
   (see `src/features/audit/chain.ts`); reordering or adding fields
   to the hash input is a chain rebuild and breaks every existing
   verifier. The verifier
   (`src/features/audit/chain.ts::verifyAuditChain`) walks rows in
   order and re-derives each hash; the `/admin/audit` page calls
   it and renders a green/red banner via
   `chain-status.client.tsx`. Never write to `audit_log` outside
   the slice's `record()` use-case.

3. **JWKS rotation is automatic + in-process.**
   `src/features/auth/cron.ts::startCron()` is started exactly once
   per Node process from `src/instrumentation.ts` (gated on
   `NEXT_RUNTIME === 'nodejs'`). It nudges hourly; the use-case
   rotates only when the latest key is older than 90 days.
   Multi-replica safe via
   `pg_advisory_xact_lock(JWKS_ROTATION_LOCK_KEY = 3828642905)` —
   even if N replicas all wake on the same hour boundary exactly
   one rotates. Manual override is the "Rotate now" button at
   `/admin/applications`, which calls the same use-case with
   `force: true`. The button is gated by `requireAdmin` AND
   `requireFreshSession`.

4. **Reauth gate guards every destructive admin action.** The list
   today: `user.ban/unban`, role change to admin, `user.delete`,
   `user.impersonate`, `org.delete`, `app.delete`,
   `webhook.delete`, `webhook.rotate-secret`, `jwks.rotate`. Each
   action server-side calls `requireFreshSession({ returnTo })`
   from `src/features/auth/use-cases/require-fresh-session.ts`,
   which redirects to `/reauth?return_to=…` if `lastPasswordAt`
   on the session row is older than `maxAgeMin` (default 5).
   `lastPasswordAt` is a Better Auth session-additional-field
   set on session create and refreshed by the `/reauth` flow.
   Forget the guard → an attacker with a stolen cookie can
   nuke a tenant in one click.

5. **Webhook secrets are encrypted at rest.** The cipher lives in
   `packages/iedora-identity/src/secret-storage.ts` — AES-256-GCM
   with an HKDF-derived key (input keying material:
   `BETTER_AUTH_SECRET`). New webhook subscriptions are encrypted
   on insert; existing rows are decrypted in-flight before the
   sender signs the envelope. Never store a plaintext webhook
   secret in `webhook_subscription.secret` (or any other column).

6. **Impersonation is fully audited, BEFORE-and-AFTER the cookie
   flip.** `src/app/admin/users/[id]/actions.ts::impersonateAction`
   writes the `user.impersonate` audit row BEFORE swapping the
   session cookie (so the audit record is attributed to the
   admin's session, not the impersonated user's).
   `src/app/(authed)/impersonation-actions.ts::stopImpersonatingAction`
   writes the `user.impersonate_stop` row AFTER the flip back.
   While impersonating, `src/app/(authed)/impersonation-banner.tsx`
   renders a cinnabar banner on every authed page whenever
   `session.session.impersonatedBy` is set. Reordering the audit
   write vs the cookie flip is a security regression — the test
   in `src/features/auth/__tests__/impersonation.test.ts` pins
   the ordering.

7. **Telemetry is OFF on both apps.** Better Auth 1.6 ships an
   opt-out telemetry collector — both apps explicitly set
   `telemetry: { enabled: false }` in `better-auth-instance.ts`.
   Genkan additionally pins
   `emailAndPassword.minPasswordLength: 12` (menu inherits the
   default; menu sign-up flows through genkan anyway, so the
   policy is effectively centralised).

## File layout

```
products/genkan/
  src/
    app/
      (auth)/                          login + signup (the only pages public sign-up sees)
      (authed)/                        consent, profile, reauth, impersonation-banner
      admin/                           /admin/* — users, organizations, applications, sessions,
                                       grants, audit, webhooks. Every server action calls
                                       requireFreshSession before mutating.
      api/
        auth/[...all]/                 Better Auth handler (also serves OAuth-provider endpoints)
        identity/organization/*        OAuth-bearer endpoints menu calls into
      up/route.ts                      health check
      layout.tsx, page.tsx, globals.css
    features/
      admin/                         user/org/app/webhook/grant listings + requireAdmin guard
      audit/                         hash-chained audit_log: record + verify + list
        chain.ts                       sha256-chain helpers + AUDIT_CHAIN_LOCK_KEY constant
        verify.ts                      walks the chain, reports first tamper point
        sender.ts                      forwards events to @iedora/identity webhook sender
      auth/                          Better Auth instance + DAL + reauth + JWKS rotation cron
        adapters/better-auth-instance.ts   betterAuth() factory — telemetry off, role.input=false
        adapters/better-auth.ts            gateway adapter
        adapters/bearer-auth.ts            OAuth-bearer verifier for /api/identity/*
        cron.ts                            startCron() — hourly JWKS rotation kick
        oidc/discovery.ts                  custom additions to /.well-known/openid-configuration
        use-cases/require-fresh-session.ts step-up guard for destructive actions
        use-cases/rotate-jwks.ts           advisory-locked rotation use-case
        __tests__/                         impersonation, role-escalation, jwks, fresh-session
      profile/                       user-facing profile reads (org list, grant list)
      webhooks/                      subscription CRUD + dispatch (uses @iedora/identity sender)
    shared/
      db/{client.ts,schema.ts}       drizzle client + canonical schema (auth.* + audit_log + …)
      env.ts                         Zod-validated env
      testing/pglite.ts              makeTestDb() — same shape as menu's
    instrumentation.ts               Next register() hook — starts the cron (nodejs runtime only)
  drizzle/                           generated SQL migrations
  drizzle.config.ts
  package.json                       genkan deps; @iedora/{identity,design-system} workspace deps
  scripts/check-migrations.ts        same guardrail as menu's
  infra/                             genkan's deploy machinery (sibling to menu's)
    Dockerfile, justfile, tofu/, kamal/, bin/with-secrets, .env.example
    # Genkan's app container reaches `infra-postgres:5432` on the shared
    # kamal Docker network. Separate logical databases: `menu` for menu,
    # `genkan` for genkan. The shared infra workspace at /infra/ owns
    # the Postgres + backups accessories.
```

## Commands

- `bun run dev` — Next.js dev server on **port 3001** (menu sits on 3000).
- `bun run typecheck` / `lint` / `test` / `test:watch` — same shape as menu.
- `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle, same shape.
- `bun run auth:generate` — sync Better Auth tables into `src/shared/db/schema.ts`.
- No `test:e2e` script — genkan has no Playwright suite (see `docs/testing.md` for why).

Deploy commands live at the repo root — see `AGENTS.md` § Useful commands.
