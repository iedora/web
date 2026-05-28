# ADR-0001 — Bun everywhere (deferred)

**Status:** Deferred — blocked by upstream bugs.
**Date:** 2026-05-28
**Decider:** @eduvhc

## Context

A iedora corre num Beelink mini PC sob Kamal:
- Build: `oven/bun:1.3-debian` (Bun gere workspaces)
- Runtime: `node:24-bookworm-slim` (Node serve a app)
- DB driver: `postgres` npm package via `drizzle-orm/postgres-js`
- Auth: `better-auth` (sessions + organizations)
- Edge: Cloudflare Tunnel → kamal-proxy → Next.js standalone

O `apps/web/Dockerfile` runtime stage faz **`npm install drizzle-orm@0.45.2 postgres@3.4.9`** como workaround porque `@vercel/nft` (Next's File Tracer) salta silenciosamente os conditional exports do drizzle, não copiando-os para `.next/standalone/node_modules`. O `outputFileTracingIncludes` config em `next.config.ts` tenta forçar, mas empiricamente não funciona para packages com `exports` map.

Dois custos directos:
1. **~20 MB extra** no image (drizzle 7 MB + postgres 5 MB + transitives).
2. **Build não-puramente-Bun** — npm chama-se uma vez por construção.

Em 2026 o Bun ganhou:
- `Bun.SQL` — Postgres client nativo (Bun 1.2+, Jan 2025)
- `drizzle-orm/bun-sql` adapter (drizzle 0.39.0+)
- `drizzle-orm/bun-sql/migrator` (drizzle PR #4109)

Eliminaria por completo a dependência `postgres` (substituída pelo binding nativo do Bun) — só `drizzle-orm` ficaria em node_modules. Mas requer o runtime ser **Bun** (não Node), porque `import { SQL } from 'bun'` só resolve sob Bun.

## Decision

**Target de longo prazo: Bun runtime end-to-end** (Cenário C abaixo). Reduz dependências, alinha-se com o stack já-Bun-no-build, elimina o hack `npm install`.

**Para já: ficar como está** (Cenário status quo). Os bloqueadores upstream tornam a migração inviável em 2026-05-28.

## Cenário C — Bun everywhere

### Changes (when blockers lift)

1. **`packages/db/src/client.ts`** — `createDb` passa de `drizzle-orm/postgres-js` para `drizzle-orm/bun-sql`:
   ```ts
   import { SQL } from 'bun'
   import { drizzle } from 'drizzle-orm/bun-sql'
   export function createDb<T>(url: string, schema: T) {
     return drizzle({ client: new SQL(url, { max: 10 }), schema })
   }
   ```

2. **`packages/db/src/migrate.mjs`** — analogamente:
   ```ts
   import { SQL } from 'bun'
   import { drizzle } from 'drizzle-orm/bun-sql'
   import { migrate } from 'drizzle-orm/bun-sql/migrator'
   ```

3. **`apps/web/Dockerfile`** — runner stage muda de `node:24-bookworm-slim` para `oven/bun:1.3-debian-slim`:
   - `CMD ["bun", "server.js"]` (em vez de `node server.js`)
   - **Apaga o `RUN npm install drizzle-orm postgres`** (não preciso — Bun.SQL é nativo, drizzle-orm fica via outputFileTracingIncludes que funciona melhor sob Vite-based bundlers... ver "Triggers" abaixo)

4. **`.kamal/hooks/pre-deploy`** — `bun /app/.../migrate.mjs` em vez de `node`.

5. **Drop dependência `postgres`** do workspace (era usado só para postgres-js client).

### Trade-offs

| | Status quo | Cenário C |
|---|---|---|
| Image base runtime | node:24 (~140 MB) | oven/bun:1.3-debian-slim (~115 MB) |
| Runtime deps | drizzle-orm + postgres | drizzle-orm (Bun.SQL nativo) |
| Build tooling | npm (1 use) + Bun | Bun (everywhere) |
| DB driver perf | postgres-js (JS) | Bun.SQL (C++ bindings, ~50% faster row reads em micro-benches) |
| Migrate runtime | Node | Bun (mesma orquestração) |
| Risk | Conhecido, estável | Bloqueado por bugs upstream |

## Blockers (2026-05-28)

Estes têm de fechar antes de Cenário C ser viável:

1. **[better-auth/better-auth#6781](https://github.com/better-auth/better-auth/issues/6781)** — better-auth falha o build em Next 16 sob Bun runtime. Usamos better-auth para sessões + organizations. Hard blocker.

2. **[oven-sh/bun#14496](https://github.com/oven-sh/bun/issues/14496)** — Bun crash em Next standalone + middleware. Usamos `apps/web/src/proxy.ts` (Next middleware) para routing host-based. Hard blocker.

3. **`@vercel/nft` + conditional exports** — para apagar o `RUN npm install` workaround, precisamos que nft trace correctamente packages com `exports` map. Issue em aberto em Next.js (#68740, #89377). Soft blocker — workaround actual (~20 MB) é viável.

## Alternativas consideradas

### Vinext (vinext.dev, Cloudflare's Vite-based Next replacement)

Pesquisado em 2026-05-28. **Rejeitado:**
- v0.0.46, explicitamente "Experimental — under heavy development"
- 189 open issues
- Auditoria de segurança Hacktron: 24 vulnerabilidades, 4 critical (Authorization header cache poisoning, double-URL-encoding bypass, AsyncLocalStorage session pollution, `/api/*` excluído silentemente de middleware por defeito)
- Sem suporte oficial documentado para better-auth, next-intl, nem host-based routing em middleware
- Trade-off: troca 3 issues conhecidos por framework experimental com CVEs ativos + cobertura desconhecida do nosso stack
- Bun + vinext: Nitro tem preset Bun mas docs sparse, sem production users known

Reavaliar quando vinext atingir 0.1.x+ com auditoria CVE limpa e docs para better-auth/next-intl.

### Cenário A (só trocar `npm install` por `bun install`)

ROI negativo (+25 MB de bun binary no runtime, ~5s ganhos em build time). Skipped.

### Cenário B (só migrate.mjs em Bun-SQL, app fica em Node+postgres-js)

ROI marginal — app ainda precisa do `postgres` package, sem dropar deps. Adds 25 MB de bun binary só para correr migrations 1×/deploy. Skipped.

## Triggers para revisitar

Mover para Cenário C quando QUALQUER destes acontecer:
- better-auth#6781 fecha como resolved (ou release notes explicit "Bun runtime supported")
- Bun publica nota de blog ou release notes mencionando "Next.js 16 standalone + middleware fix" para #14496
- Migração para outro framework auth (se motivada por outras razões)
- Apaixonamento por outra coisa que torne better-auth/Next middleware substituíveis

## References

- [Bun.SQL docs](https://bun.sh/docs/api/sql)
- [Drizzle bun-sql connect](https://orm.drizzle.team/docs/connect-bun-sql)
- [Drizzle PR #4109 — bun-sql migrator](https://github.com/drizzle-team/drizzle-orm/pull/4109)
- [better-auth#6781](https://github.com/better-auth/better-auth/issues/6781)
- [bun#14496](https://github.com/oven-sh/bun/issues/14496)
- [next#68740 — nft conditional exports](https://github.com/vercel/next.js/issues/68740)
- [Hacktron audit of vinext](https://www.hacktron.ai/blog/hacking-cloudflare-vinext)
