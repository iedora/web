# Runbook — deploy (Coolify)

Single-node homelab. Deploy é **`git push origin main`** → Coolify webhook
→ build (apps/web/Dockerfile) → swap. Nada corre no Mac.

## Stack

- **Coolify** v4.1.x — UI em `https://coolify.iedora.com` (atrás de Authelia).
  Plataforma gerida por [`homelab-iac`](https://github.com/eduvhc/homelab-iac).
- **Runner**: `coolify-runner-01` LXC (Docker + Traefik). Builds + serve.
- **Ingress**: Cloudflare tunnel `coolify-iedora` (HA, 8 conexões).
  Wildcard `*.iedora.com` → Traefik no runner → app pelo Host header.
- **DB**: Postgres 18 como **Coolify Resource** (1 container; as DBs `core`
  e `menu` são criadas automaticamente pelo migrator no pre-deploy).
- **Object storage**: R2 bucket `iedora-assets` + token bucket-scoped,
  geridos no repo de infra `iedora/infra` (`tofu/r2.tf`). Os outputs
  sincronizam para `iedora-infra/stacks/web/secrets.env` via `sync-secrets.sh`.
- **Registry**: nenhum — Coolify builda no runner a partir do GitHub clone,
  imagem fica no Docker local do runner.

## Setup inicial (uma vez)

### 1. Coolify Resource — Postgres

UI Coolify → Project `iedora` → "+ New Resource" → "PostgreSQL 18":

| Campo | Valor |
|---|---|
| Server | `coolify-runner-01` |
| Name | `iedora-pg` |
| Postgres User | `postgres` |
| Postgres DB | `postgres` (default; as DBs por-produto são criadas pelo migrator) |
| Backups | schedule = `0 3 * * *`, destination = R2 (mesmas creds que iac state), retention = 14d |

Anota a password gerada — vai para o `DATABASE_URL`.

### 2. Coolify Application — iedora-web

UI Coolify → Project `iedora` → "+ New Resource" → "Public Repository":

| Campo | Valor |
|---|---|
| Repository | `https://github.com/eduvhc/iedora` |
| Branch | `main` |
| Build Pack | Dockerfile |
| Dockerfile Location | `/apps/web/Dockerfile` |
| Base Directory | `/` (repo root é o build context) |
| Port (container) | `3000` |
| Health Check Path | `/up` |
| Domains | `iedora.com,menu.iedora.com,core.iedora.com` |
| Webhook auto-deploy | ✓ enabled |

### 3. Environment variables (Coolify UI → Application → Environment)

Three sources, by lifecycle:

**Plain config (paste literally into Coolify UI):**

```
NODE_ENV=production
CORE_BASE_URL=https://core.iedora.com
CORE_COOKIE_DOMAIN=.iedora.com
CORE_TRUSTED_ORIGINS=https://iedora.com,https://menu.iedora.com,https://core.iedora.com
NEXT_PUBLIC_CORE_URL=https://core.iedora.com
NEXT_PUBLIC_MENU_URL=https://menu.iedora.com
NEXT_PUBLIC_BRAND_URL=https://iedora.com
IEDORA_BOOTSTRAP_ADMIN_EMAILS=eduardoferdcarvalho@gmail.com
LOG_LEVEL=info
```

**Secrets — encrypted source of truth in `apps/web/.env.prod` (sops+age):**

```bash
bun prod:env:show          # decrypt + print to stdout (pipe to clipboard, paste in UI)
bun prod:env:edit          # open in $EDITOR (re-encrypts on save)
bun prod:env:updatekeys    # re-wrap DEK after editing .sops.yaml recipients
```

This file holds: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `CORE_SECRET`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`.
When rodas o tofu de R2 (no repo `iedora/infra`, `tofu/r2.tf`) para
criar/rotar o token, copia os 5 outputs para `.env.prod` e re-cola em
Coolify. Marca cada key de `.env.prod` como "Is Secret" ✓ na Coolify UI.

Recipients (who can decrypt) are listed in [`.sops.yaml`](../.sops.yaml).
To onboard a new operator machine or revoke one, see the workflow in
[`homelab-iac/docs/setup-from-scratch.md`](https://github.com/eduvhc/homelab-iac/blob/main/docs/setup-from-scratch.md#onboarding-a-new-machine-existing-operator-with-a-working-key-required)
and remember to run `bun prod:env:updatekeys` here too.

**Database URLs — Coolify UI only, tied to Coolify-managed Postgres:**

```
CORE_DATABASE_URL=postgresql://postgres:<pg-pw>@iedora-pg:5432/core
MENU_DATABASE_URL=postgresql://postgres:<pg-pw>@iedora-pg:5432/menu
```

(`<pg-pw>` é a password gerada pelo Coolify Resource Postgres no passo 1.
Não vive em `.env.prod` — se o Coolify rotar a Postgres é ele que injecta
o novo valor; ter aqui criaria drift.)

### 4. Migrations (pre-deploy command)

Coolify UI → Application → "Pre-deployment Command":

```sh
sh -c "node /app/packages/business/auth/migrate.mjs && node /app/products/menu/migrate.mjs"
```

Corre num container efémero antes do traffic swap. Falha aborta o deploy.

### 5. Deploy

Carrega "Deploy" na UI Coolify (1× manual para validar). Subsequent pushes
em `main` disparam via webhook automaticamente.

## Deploy normal

```bash
git push origin main
```

Coolify pega no webhook → faz `git pull` no runner → `docker build` →
corre migrations → swap. Logs em real-time na UI.

## Rollback

UI Coolify → Application → "Deployments" tab → escolhe deployment
anterior → "Redeploy". Coolify guarda as N últimas imagens locais.

## Ops

```bash
# logs em tempo real — via UI (mais simples) ou:
ssh root@192.168.50.210 'docker logs -f --tail=200 $(docker ps -qf "label=coolify.applicationName=iedora-web")'

# psql contra a DB
ssh root@192.168.50.210 'docker exec -it $(docker ps -qf "name=iedora-pg") psql -U postgres'
```

## Mudar hostnames

UI Coolify → Application → Domains → adicionar/remover. Coolify regenera
Traefik routing. CF tunnel wildcard `*.iedora.com` já cobre subdominios
— apex `iedora.com` precisa de route explícita no `homelab-iac`
(`services/coolify-runner-01/tunnel-routes.yaml`).

## Backups & recovery

- **Postgres**: backup diário Coolify → R2 (retenção 14d). Restore = UI →
  Database → Backups tab → "Restore".
- **App image**: rebuild via `git push` (idempotente — o Dockerfile é
  determinístico para o mesmo SHA).
- **Env vars**: source-of-truth está em `apps/web/.env.prod` (sops, neste
  repo). Se Coolify morrer: `bun prod:env:show` em qualquer máquina com
  age key autorizada (recipients em [`.sops.yaml`](../.sops.yaml)) →
  re-cola na UI ao recriar a app.
- **Uploads R2**: bucket sobrevive — versionamento + soft delete são
  feature do CF Dashboard (configurar se ainda não estiver).

## Layout do repo (deploy-related)

```
iedora/
  apps/web/
    Dockerfile                        Multi-stage, Node runtime
    .env.prod                         Runtime secrets (sops+age encrypted)
  infra/
    dev/docker-compose.yml            Postgres + s3mock (local dev)
    tofu/r2/                          CF R2 bucket + creds (outputs → .env.prod)
```

Tudo o que é homelab (LXCs, CF tunnel, DNS, Coolify install) vive em
[`homelab-iac`](https://github.com/eduvhc/homelab-iac). Tudo o que é
app-específico (incluindo a sua infra externa) vive aqui.
