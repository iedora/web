# Iedora — Deploy

> Deploy é Kamal. Infra-bootstrap é day-0. Tudo o resto é SSH para a box.

## Architecture

```
┌──────────────────────────────┐
│   infra-bootstrap/           │  Day 0 — uma vez por homelab
│   cloudflare-tunnel.sh       │  Cria/reutiliza CF Tunnel + DNS
│   r2-bucket.sh               │  Cria R2 bucket + credenciais S3
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│   Kamal                      │  Day 1+ — deploys incrementais
│   config/deploy.yml          │  Serviço: iedora-web (Next.js)
│   config/deploy.production.yml│  Server: 192.168.50.53 (Beelink)
│   .kamal/secrets.production  │  DB URLs, S3, tunnel, OTel (BWS).
│                              │  Registry password vem do env.
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│   homelab-core-infra/        │  Sidecar — OpenObserve (observability)
│   docker-compose.yml         │  Rede separada, porta 5080 publicada
│   up.sh                      │  Boot com secrets de BWS
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│   Beelink (192.168.50.53)    │
│   ┌──────────────────────┐   │
│   │  kamal-proxy :3001    │   │  HTTP → app :3000
│   │  cloudflared          │   │  Tunnel → CF edge
│   │  postgres:17          │   │  Kamal accessory
│   │  iedora-web :3000     │   │  Next.js (menu + core + house)
│   └──────────────────────┘   │
│                              │
│   (rede Docker `kamal`)      │
└──────────────────────────────┘
```

**Secret bus:** Bitwarden Secrets Manager (BWS). Kamal lê em tempo de
deploy via `kamal secrets fetch --adapter bitwarden-sm all`. O operador
precisa só de `BWS_ACCESS_TOKEN` exportado na shell.

## Day 0 — Bootstrap do homelab

Correr uma vez quando o homelab é novo. Pré-requisitos: Docker no host,
SSH key do operador autorizada, `BWS_ACCESS_TOKEN` exportado.

### 1. Cloudflare Tunnel + DNS

```bash
./infra-bootstrap/cloudflare-tunnel.sh
```

Cria (ou reutiliza) o tunnel `iedora-beelink`, configura ingress para 5
hostnames (iedora.com, www, menu, core, imopush) apontando para
`http://kamal-proxy:80`, faz update/reaponta dos CNAMEs da zona,
guarda `IEDORA_TUNNEL_TOKEN` em BWS.

Idempotente. Se o tunnel já existe, só reaponta DNS e re-grava o token.

### 2. R2 bucket + S3 credentials

```bash
./infra-bootstrap/r2-bucket.sh
```

Provisiona o bucket `iedora-assets` (uploads do menu: logos, banners,
QR stickers), cria um token S3-compatível scoped ao bucket, grava
`IEDORA_S3_ACCESS_KEY_ID` e `IEDORA_S3_SECRET_ACCESS_KEY` em BWS.

Idempotente. Skip se bucket + credenciais já existem.

### 3. homelab-core-infra (OpenObserve)

```bash
./homelab-core-infra/up.sh
```

Boot do OpenObserve na rede Docker `homelab-core`. As credenciais
admin vêm de BWS (`OPENOBSERVE_ADMIN_PASSWORD`). O iedora-web chega
ao OO via `host.docker.internal:5080`.

Para remote (Beelink):
```bash
./homelab-core-infra/up.sh --host ssh://root@192.168.50.53
```

## Day 1 — Primeiro deploy

Depois do bootstrap (ou num homelab já pronto):

```bash
export BWS_ACCESS_TOKEN=0.…  # de ~/.secrets ou bws run

# Boot de tudo
kamal setup -d production

# Smoke test
curl -sI https://menu.iedora.com/up   # → 200
curl -sI https://core.iedora.com       # → 200
curl -sI https://iedora.com            # → 200
```

`kamal setup` faz:
1. Provisions o VPS (se `kamal-proxy` não existir, instala-o)
2. Cria a rede Docker `kamal`
3. Boot postgres (accessory) com init.sql que cria DBs `menu`, `core`,
   `imopush`
4. Boot cloudflared (accessory) com o tunnel token de BWS
5. Build + push da imagem (ou pull de `git.iedora.com/eduvhc/web:latest`)
6. Boot kamal-proxy na porta 3001
7. Boot iedora-web na porta 3000
8. Healthcheck `/up`

Kamal **corre directamente no Beelink** (instalado via gem por
`./homelab-core-infra/up.sh --host ssh://root@192.168.50.53`). O CI
faz `rsync` da source para `/opt/iedora` no Beelink + `ssh` para
chamar `kamal deploy`. Sem builder remoto, sem buildkit container —
docker driver local respeita o `insecure-registries` do daemon.json
e o push é localhost-to-localhost.

## Day 2 — Deploys incrementais

Em CI: push a `main` (ou `workflow_dispatch`) → workflow `Pipeline`
job `deploy` faz rsync + ssh trigger Kamal.

Localmente do Mac (ssh-trigger directo):

```bash
ssh root@<host> "cd /opt/iedora && git fetch && git checkout <SHA> && \
  BWS_ACCESS_TOKEN=… kamal deploy -d production"
```

Hot-swap zero-downtime: Kamal sobe o novo container ao lado do atual,
espera o healthcheck, faz swap de tráfego, derruba o antigo.

Rollback (do Mac ou via SSH):
```bash
ssh root@192.168.50.53 'cd /opt/iedora && kamal rollback <version> -d production'
```

## Day 2 — Operações correntes

Tudo via SSH para o Beelink:

```bash
HOST=192.168.50.53

# Logs
ssh root@$HOST docker logs -f --tail=200 iedora-web       # ou iedora-web-postgres / cloudflared

# psql
ssh -t root@$HOST docker exec -it iedora-web-postgres psql -U postgres

# Kamal proxy
ssh root@$HOST docker logs kamal-proxy --tail 50

# Listar containers
ssh root@$HOST docker ps
```

### Secret rotation

| Secret | Como rodar |
|--------|------------|
| BWS token | Regenerar no Bitwarden UI, atualizar `~/.secrets` |
| Gitea registry PAT (`eduvhc/kamal-ci-*`) | `./homelab-core-infra/up.sh --host ssh://root@192.168.50.53 --bootstrap-ci` |
| DB passwords | `bws secret edit IEDORA_POSTGRES_PASSWORD --value <novo>`, `kamal setup -d production` recria o postgres |
| CF tunnel token | `./infra-bootstrap/cloudflare-tunnel.sh` re-grava |

**Migrations** correm no boot do container (via `scripts/migrate.mjs`
no Dockerfile) ou manualmente:

```bash
ssh -t root@$HOST docker exec iedora-web node /app/packages/core-auth/scripts/migrate.mjs
ssh -t root@$HOST docker exec iedora-web node /app/products/menu/scripts/migrate.mjs
```

## CI

Push a main dispara `.gitea/workflows/ci.yml`:
1. Jobs `ci` (typecheck + lint + test) e `audit` (gitleaks + hadolint
   + osv) correm em paralelo.
2. Job `deploy` (`needs: [ci, audit]`) corre `kamal deploy -d
   production` — build remoto + push para Gitea OCI registry +
   blue-green swap.

Ver `docs/ci/README.md`.

## BWS keys usadas

BWS guarda secrets que cruzam boundary externo (DB, S3, OO, CF). O
registry OCI do Gitea autentica-se internamente — esse token é
gerado por `./homelab-core-infra/up.sh --bootstrap-ci` (revoga PATs
antigos do prefix `kamal-ci-` + cria novo + publica como Actions
secret `KAMAL_REGISTRY_PASSWORD` na repo `eduvhc/iedora`).

| Key | Onde é criada | Onde é lida |
|-----|--------------|-------------|
| `IEDORA_TUNNEL_TOKEN` | `cloudflare-tunnel.sh` | `.kamal/secrets.production` |
| `IEDORA_S3_ACCESS_KEY_ID` | `r2-bucket.sh` | `.kamal/secrets.production` |
| `IEDORA_S3_SECRET_ACCESS_KEY` | `r2-bucket.sh` | `.kamal/secrets.production` |
| `IEDORA_POSTGRES_PASSWORD` | Operador (Bitwarden UI) | `.kamal/secrets.production` |
| `IEDORA_AUTH_SECRET` | Operador (Bitwarden UI) | `.kamal/secrets.production` |
| `OPENOBSERVE_ADMIN_PASSWORD` | Operador (Bitwarden UI) | `homelab-core-infra/up.sh` |
| `CLOUDFLARE_API_TOKEN` | Operador (Bitwarden UI) | `cloudflare-tunnel.sh`, `r2-bucket.sh` |

## Ficheiros

```
config/
  deploy.yml                Kamal base config (service, image, builder,
                            accessories, env, proxy)
  deploy.production.yml     Production overlay (servers, add-host)

.kamal/
  secrets.production        DB URLs, S3, tunnel, OTel (fetch via BWS).
                            KAMAL_REGISTRY_PASSWORD vem do environment
                            (Actions secret em CI, export local).

infra-bootstrap/
  cloudflare-tunnel.sh      Day 0 — CF Tunnel + DNS
  r2-bucket.sh              Day 0 — R2 bucket + S3 creds

homelab-core-infra/
  docker-compose.yml        OpenObserve stack
  up.sh                     Boot com secrets de BWS

dev/
  docker-compose.yml        Postgres + s3mock local
  .env                      Portas, initial buckets
```

## Ver também

- `docs/deploy/troubleshooting.md` — modos de falha
- `docs/dev.md` — dev local
