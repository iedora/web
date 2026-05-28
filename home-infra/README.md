# home-infra

Infra base **genérica** do homelab. Sem hardcodes de apps específicas
(iedora, beelink, etc) — qualquer app consumer (`home-infra/<app>/`)
arranca em cima destes services.

## Layout

```
home-infra/
  scripts/              # setup genérico one-time (server novo)
    bootstrap.sh        # install-kamal + boot services
    install-kamal.sh    # SSH: apt + ruby + kamal + bws + ssh-loopback key
  <service>/            # services partilhados (openobserve, gitea)
    bin.sh              # idempotent, zero flags
    .env                # COMMITTED, config hardcoded non-secret
    docker-compose.yml
    scripts/            # utils per-service (idempotent, genéricos)
  my-services/          # apps consumers (iedora, ...)
    <app>/
      README.md
      scripts/
        bootstrap.sh    # app-specific setup (idempotent)
        ...
```

## 1 comando para server novo

```bash
export BWS_ACCESS_TOKEN='...'
export HOMELAB_HOST='ssh://root@<ip>'

./home-infra/scripts/bootstrap.sh
```

`bootstrap.sh` corre em ordem (idempotent):

1. `install-kamal.sh` — apt deps + Kamal gem + BWS CLI + SSH loopback
   keypair no `HOMELAB_HOST`
2. `openobserve/bin.sh` — boot OpenObserve
3. `gitea/bin.sh` — boot Gitea + Caddy + runner
4. `cloudflared/bin.sh` — provisiona tunnel `homelab-admin` (expõe
   gitea + OO publicamente; sign-in nativo da app; Authentik SSO
   planeado) + boot connector

Setup de uma app consumer (clone source, CF tunnel, R2 bucket, PAT
do Gitea, `/etc/hosts` overrides, etc.) vive na própria app — ex:
`home-infra/iedora/scripts/bootstrap.sh` (futura migração).

## Dia-a-dia (services)

Operations normais — reiniciar ou actualizar um service:

```bash
export BWS_ACCESS_TOKEN='...'

DOCKER_HOST=ssh://root@<ip> ./home-infra/openobserve/bin.sh
DOCKER_HOST=ssh://root@<ip> ./home-infra/gitea/bin.sh
```

`bin.sh` (idêntico em todos os services):

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${BWS_ACCESS_TOKEN:?must be set}"
docker network inspect homelab-core >/dev/null 2>&1 || docker network create homelab-core
cd "$(dirname "${BASH_SOURCE[0]}")"
exec bws run -- docker compose up -d
```

## Config vs Secret

| | Onde | Visibilidade | Exemplo |
|---|---|---|---|
| **Config** (hardcoded) | `<service>/.env` (committed) | público no repo | `ZO_ROOT_USER_EMAIL`, `GITEA_DOMAIN` |
| **Secret** (sensível) | Bitwarden Secrets (BWS) | injectado em runtime via `bws run` | `OPENOBSERVE_ADMIN_PASSWORD`, `CLOUDFLARE_API_TOKEN` |

Composes referenciam `${KEY}` — compose resolve via shell env (`bws
run`-injected) + `.env` (next to compose). Nome do `${KEY}` no compose
== nome da key no BWS (secrets) ou no `.env` (config).

## Services

| Service | Conteúdo | Portas | BWS keys |
|---|---|---|---|
| `openobserve/` | OpenObserve | 5080 (UI/OTLP HTTP), 5081 (OTLP gRPC) | `OPENOBSERVE_ADMIN_PASSWORD` |
| `gitea/` | Gitea (git/UI/Actions/registry) + Caddy (TLS via CF DNS-01) + Actions runner | 3030 (UI), 3022 (SSH), 4443 (HTTPS Caddy) | `CLOUDFLARE_API_TOKEN` |
| `cloudflared/` | Connector do tunnel `homelab-admin` — expõe `git.iedora.com` + `observe.iedora.com` publicamente | — | `CLOUDFLARE_API_TOKEN`, `HOMELAB_ADMIN_TUNNEL_TOKEN` |

### Topologia de tunnels

| Tunnel | Owner | Hostnames | Auth | Lifecycle |
|---|---|---|---|---|
| `iedora-public` | `my-services/iedora/cloudflared/` | iedora.com, www, menu, core, imopush | anónimo | compose standalone |
| `homelab-admin` | `home-infra/cloudflared/` | git.iedora.com, observe.iedora.com | sign-in nativo da app (Authentik SSO planeado) | compose standalone |

Ambos os connectors vivem na rede `homelab-core` (resolução por Docker DNS para os service targets). Em multi-host: `iedora-public` deploya em cada app host (CF load-balances connectors), `homelab-admin` fica no infra host.

**East-west cross-host** (Kamal pull, OO logs push) **não** passa pelos tunnels — usa LAN ou Tailscale via `/etc/hosts` (`git.iedora.com:4443` → IP do infra host).

### Gitea utils (`home-infra/gitea/scripts/`)

Genéricos — qualquer consumer pode usar:

| Util | Função |
|---|---|
| `create-token.sh` | Cria PAT via Gitea API. Idempotent (revoga PAT com mesmo nome antes). Stdout = valor do PAT |
| `set-actions-secret.sh` | Publica Actions secret numa repo (PUT idempotent) |
| `create-org.sh` | Cria/actualiza org + adiciona users aos teams Owners/Members. Idempotent. Inputs: `ORG_NAME`, `ORG_OWNERS`, `ORG_MEMBERS` (CSV), `ORG_DESCRIPTION`, `ORG_VISIBILITY` |

Exemplo (em `home-infra/iedora/scripts/bootstrap.sh` futuro):

```bash
GITEA_URL=https://git.iedora.com \
GITEA_USER=eduvhc \
GITEA_PASSWORD="$GITEA_PASSWORD" \
TOKEN_NAME=iedora-deploy \
TOKEN_SCOPES=read:repository,write:package \
  PAT=$(./home-infra/gitea/scripts/create-token.sh)

# Usa PAT para clone /opt/iedora + publica como Actions secret:
GITEA_URL=https://git.iedora.com \
GITEA_AUTH_TOKEN="$PAT" \
REPO=eduvhc/iedora \
SECRET_NAME=KAMAL_REGISTRY_PASSWORD \
SECRET_VALUE="$PAT" \
  ./home-infra/gitea/scripts/set-actions-secret.sh
```

## Boot order

1. `home-infra/openobserve`
2. `home-infra/gitea`
3. `home-infra/cloudflared` (admin tunnel — depois dos services que expõe)
4. *Depois*: `home-infra/my-services/<app>/` (consumers — iedora, etc.)

Ordem entre `openobserve` e `gitea` é livre.

## Volumes & migração

Volumes referenciam os nomes da config anterior
(`homelab-core-infra_*`) via `external: true` — preserva dados.

Para homelab **novo**: apagar os blocos `external: true`; compose cria
volumes com o seu próprio prefix (`home-infra-gitea_*`).

Migração da config antiga:

```bash
DOCKER_HOST=ssh://root@<ip> \
  docker compose -f homelab-core-infra/docker-compose.yml --profile extras down

DOCKER_HOST=ssh://root@<ip> ./home-infra/openobserve/bin.sh
DOCKER_HOST=ssh://root@<ip> ./home-infra/gitea/bin.sh
```

`homelab-core-infra/` + `infra-bootstrap/` desaparecem na próxima
sessão (migração para `home-infra/iedora/`).
