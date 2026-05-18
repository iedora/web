# House — `products/house/`

The iedora.com root brand site. Astro static output, deployed to Cloudflare Workers Static Assets. Deliberately small — no DB, no auth, no Bun-server build step. Composes the shared `@iedora/design-system` editorial primitives.

**No code-level hard rules beyond the README.** If you find yourself wanting to add server-side behaviour, use Astro Server Islands rather than full SSR (per `docs/scaling.md`'s recommendation — the static stay matters for cache hit ratio at the edge).

See:
- `products/house/README.md` — what it is + how to deploy.
- `products/house/infra/justfile` — `deploy` / `rotate-token` recipes (Tofu mints the narrow Workers workload token; wrangler uploads `dist/`).
- Root `AGENTS.md` § Useful commands for `just house::deploy`.
