# apps/web — the Next.js shell

This is the deployable Next.js instance — UI ONLY. It mounts every
iedora surface (menu / apex landing) from one process via
host-based rewrites in `src/proxy.ts`. Routes live HERE (`src/app/`);
the slices and shared utilities they import live in
`@iedora/product-menu` and other workspace packages. ALL data, auth
and business rules live in the Go services (`services/`), reached
server-side through `@iedora/api-client`.

Repo-level conventions: [`../../AGENTS.md`](../../AGENTS.md).

## What this is (and isn't)

- **It is** the Next.js boot + root layout + global CSS + the host
  dispatcher (`proxy.ts`) + every Next.js route under `src/app/`
  (pages, server actions, layouts). The routes compose slice barrels
  from `@iedora/product-menu` and other workspace packages.
- **It is not** where slices, typed API clients, or backend logic
  live. UI slices belong to their workspace package
  (`products/menu/src/features/`); backend logic belongs to the Go
  services (`services/`). Never reintroduce databases, ORMs, S3
  clients or AI SDKs here.

## Hard rules

1. **Routes live here, slices live in products/.** `apps/web/src/app/`
   contains every `page.tsx`, `route.ts`, `layout.tsx`,
   `not-found.tsx`, and `actions.ts`. Files import from workspace
   packages by package name —
   `import { ... } from '@iedora/product-menu/features/auth'`, etc.
   Each subpath is
   declared in the target package's `package.json::exports`.
   Adding business logic INSIDE a route file is the bug — that's
   slice work (or Go work).

2. **`src/proxy.ts` owns host dispatch + the auth gate.** It is the
   ONE place that refreshes an expired access token for page loads
   (via `@iedora/api-client/middleware`), so RSCs always read a valid
   `iedora_access` cookie. Authorization proper stays with the Go
   services — every API call is verified there.

3. **`src/app/layout.tsx` + `globals.css` are the only shared chrome.**
   Per-surface layouts (e.g. the (auth) sign-in shell, dashboard
   chrome) live at the appropriate sub-route's `layout.tsx`.

4. **No tsconfig path aliasing.** `apps/web/tsconfig.json` has no
   `paths` entries. Every cross-package import goes through the
   declared package name. This is what lets new products land
   without touching this file.

5. **One image, two hosts.** The Docker image serves
   `menu.iedora.com` and `iedora.com` from the same node process. Adding a new host = new entry in
   `generated/surfaces.ts` + new sub-route under `src/app/<host>/` +
   new workspace dep in `package.json` + new entry in
   `next.config.ts::transpilePackages` + new project reference in
   `tsconfig.json::references`.

## File layout

```
apps/web/
  src/
    app/
      up/route.ts                  health check (every host; excluded
                                   from proxy matcher alongside /track)
      house/page.tsx               apex iedora.com landing
      menu/                        menu surface (rewritePath: "/menu")
        (auth)/**                    sign-in / sign-up / sign-out
                                     (server actions from
                                     @iedora/product-menu/features/auth)
        page.tsx                     landing
        _components/landing/         landing components
        dashboard/**                 operator surface (menu slices)
        onboarding/**                tenant + first-restaurant flow
        r/**                         public menu pages (SSR from Go)
        q/**                         QR sticker entry (redirect via Go)
        showcase/**                  public marketing surface
      page.tsx                     dev surface index (only rendered on
                                   bare http://localhost:3000/ — every
                                   prod host rewrites away from it)
      layout.tsx, globals.css      root chrome
    generated/surfaces.ts          host-to-surface topology (hand-maintained)
    proxy.ts                       host-based rewrite + auth gate +
                                   token refresh
  next.config.ts                   transpilePackages + the /track/:slug
                                   rewrite to the Go menu service
  tsconfig.json                    project references
  Dockerfile, next-env.d.ts, postcss.config.mjs
```

## Commands

- `bun run dev` — Next.js dev server (Turbopack). Needs the Go backend
  up first: `bun run dev:up` at the repo root.
- `bun run build` — production build (standalone output for Docker).
- `bun run start` — start the standalone server.
- `bun run typecheck` — TS check without emit.
- `bun run lint` — ESLint (`next` recommended).

Real tests live with the products and the Go module:
`bun run --cwd products/menu test`, `cd services && make test-all`.

## Deployable artefact

Image built by CI from `apps/web/Dockerfile`; deploy is owned by the
`iedora-infra` repo (Docker Swarm + Ansible). See
`docs/runbook.deploy.md`.
