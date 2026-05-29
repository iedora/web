# Runbook — deploy

Operador único, Mac → Beelink. Sem CI, sem runner. Kamal corre no Mac e
faz build local (amd64 via buildx) + push GHCR + SSH ao Beelink.

## Stack

- **Registry:** GHCR (`ghcr.io/eduvhc/iedora-web`). Auth via `gh auth token`.
- **Host:** Beelink (`192.168.50.53`). Único container pré-Kamal: pihole.
- **Ingress:** Cloudflare tunnel `iedora` → cloudflared accessory → kamal-proxy
  (mesma docker network, por container name). TLS termina no CF.
- **Accessories Kamal** (em `config/deploy.yml`):
  - `postgres` (Postgres 17, 3 DBs: core/menu/imopush)
  - `openobserve` (logs/traces/metrics, UI em `:5080` do host)
  - `otel-collector` (scrape kamal-proxy + OTLP da app → OO)
  - `cloudflared` (tunnel ingress)
- **Secrets:** SOPS+age em `~/.config/iedora/secrets.sops.yaml` (decrypt key
  em `~/.config/sops/age/keys.txt`). Lidos por `.kamal/secrets` em runtime.
- **Infra declarativa:** `infra/` (Tofu) gere CF zone + tunnel + DNS.

## Pré-requisitos no Mac

```bash
gem install kamal -v 2.11.0
brew install sops age tofu gh docker
gh auth login                          # scopes: write:packages, read:packages
docker buildx create --use             # uma vez, para emulação amd64
```

SOPS entries necessárias (`sops ~/.config/iedora/secrets.sops.yaml`):

| Key | O que é |
|---|---|
| `CORE_SECRET` | better-auth JWT secret |
| `POSTGRES_PASSWORD` | password root do postgres accessory |
| `OPENOBSERVE_ADMIN_PASSWORD` | password da admin UI do OO (collector usa para Basic auth) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | R2 creds |
| `MOONSHOT_API_KEY` | LLM (Kimi) |

`TUNNEL_TOKEN` e `KAMAL_REGISTRY_PASSWORD` não vão para o SOPS —
saem de `infra/.tunnel-token` (Tofu output) e de `gh auth token`.

## Day 0 — primeiro deploy

```bash
cp infra/live/tofu/terraform.tfvars.example infra/live/tofu/terraform.tfvars   # editar account_id
export CLOUDFLARE_API_TOKEN=...                                                # Zone:Read, DNS:Edit, Tunnel:Edit
./infra/live/deploy.sh
```

`infra/live/deploy.sh` valida pré-requisitos, corre `tofu apply`, faz `kamal deploy`,
e detecta cold-start (postgres ainda não up) para re-correr `kamal deploy` e
aplicar migrations automaticamente. Termina com smoke check em `https://iedora.com/up`.

Verificar manualmente:

```bash
ssh root@192.168.50.53 'docker ps'              # iedora-web, kamal-proxy, postgres, openobserve, otel-collector, cloudflared, pihole
curl https://iedora.com/up                       # 200
```

## Deploy normal

```bash
export CLOUDFLARE_API_TOKEN=...                 # só necessário se infra mudou
./infra/live/deploy.sh                          # idempotent — tofu apply é no-op se nada mudou
```

Ou directamente, sem reconcile do Tofu:

```bash
bun run kamal deploy                            # = kamal -c infra/live/kamal/deploy.yml deploy
```

`bun run kamal <cmd>` é wrapper que injecta `-c infra/live/kamal/deploy.yml`. Para qualquer
sub-comando Kamal (`logs`, `app exec`, `rollback`, `proxy reboot`, etc) usa o mesmo prefixo.

`KAMAL_VERSION` = git SHA. Pre-deploy hook (`.kamal/hooks/pre-deploy`)
corre as 3 drizzle migrations (`auth` → `menu` → `imopush`) num
container efémero antes do swap. Falha aborta o deploy.

## Rollback

```bash
bun run kamal rollback <version>                # version = SHA antigo (ver `bun run kamal app versions`)
```

Pre-deploy skipa em rollback (sem schema novo para aplicar).

## Mudar hostnames públicos

Editar `infra/live/tofu/main.tf:hostnames` **e** `config/deploy.yml:proxy.hosts`
(têm de bater). Depois:

```bash
(cd infra/live/tofu && tofu apply)              # actualiza ingress + DNS
bun run kamal proxy reboot                      # kamal-proxy recarrega host routing
```

## Ops

```bash
HOST=192.168.50.53
ssh root@$HOST docker logs -f --tail=200 iedora-web
ssh -t root@$HOST docker exec -it iedora-web-postgres psql -U postgres
ssh root@$HOST docker ps
open http://192.168.50.53:5080                  # OpenObserve UI
```

## Tear-down (raro)

```bash
bun run kamal remove                            # remove containers/accessories no Beelink
(cd infra/live/tofu && tofu destroy)            # destrói tunnel + DNS
```

Pihole **não** é tocado — vive fora do Kamal em `/srv/docker/pihole`.

## Layout do repo (deploy-related)

```
iedora/
  infra/
    dev/docker-compose.yml                # Postgres + s3mock para dev local
    live/
      deploy.sh                           # one-shot do Mac: tofu apply + kamal deploy
      tofu/
        main.tf                           # CF zone + tunnel + DNS
        .tunnel-token                     # gitignored, escrito por `tofu apply`
      kamal/
        deploy.yml                        # Kamal: image, proxy, accessories, env
        otel-collector.yaml               # collector → openobserve accessory
        postgres/init.sql                 # create 3 DBs (core, menu, imopush)
        .kamal/secrets                    # SOPS reads + gh auth token + Tofu .tunnel-token
        .kamal/hooks/pre-deploy           # drizzle migrations no container efémero
```
