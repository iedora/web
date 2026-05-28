# Day 2 — Operações correntes

## Deploy

```bash
kamal deploy -d production        # hot-swap zero-downtime
kamal rollback -d production      # volta à versão anterior
kamal details -d production       # status de tudo
```

## Logs

```bash
ssh root@192.168.50.53
docker logs -f --tail=200 iedora-web
docker logs -f --tail=50 iedora-web-postgres
docker logs -f --tail=50 cloudflared
docker logs kamal-proxy --tail 50
```

## psql

```bash
ssh -t root@192.168.50.53 docker exec -it iedora-web-postgres psql -U postgres
```

## Migrations

Correm no boot do container automaticamente. Para correr manualmente:

```bash
ssh -t root@192.168.50.53 docker exec iedora-web node /app/packages/auth/scripts/migrate.mjs
ssh -t root@192.168.50.53 docker exec iedora-web node /app/products/menu/scripts/migrate.mjs
```

## Kamal accessory management

```bash
kamal accessory boot postgres -d production       # se parou
kamal accessory boot cloudflared -d production     # se parou
kamal accessory reboot postgres -d production      # restart
```

## OpenObserve

```bash
ssh -L 5080:localhost:5080 root@192.168.50.53
# Abrir http://localhost:5080
```

Para re-boot do OO:

```bash
./homelab-core-infra/up.sh --host ssh://root@192.168.50.53
```

## Secret rotation

| Secret | Como rodar |
|--------|------------|
| Gitea registry token | Gitea → Settings → Applications → generate token → `bws secret edit GITEA_REGISTRY_TOKEN --value <novo>` |
| Postgres password | `bws secret edit IEDORA_POSTGRES_PASSWORD --value <novo>` → `kamal setup -d production` recria postgres |
| Auth secret | `bws secret edit IEDORA_AUTH_SECRET --value <novo>` → `kamal deploy -d production` |
| CF tunnel token | `./infra-bootstrap/cloudflare-tunnel.sh` (idempotente) |
| S3 creds | `./infra-bootstrap/r2-bucket.sh` (idempotente) |

Rodar `GITEA_REGISTRY_TOKEN` invalida o deploy em curso — próximo
`kamal deploy` precisa do novo token.

## Backup / restore

Postgres data vive no volume Docker `iedora-web-postgres`. Backup
manual:

```bash
ssh root@192.168.50.53 docker exec iedora-web-postgres pg_dumpall -U postgres | gzip > iedora-dump-$(date +%Y%m%d).sql.gz
```

Restore:

```bash
gunzip -c iedora-dump-20260101.sql.gz | ssh root@192.168.50.53 docker exec -i iedora-web-postgres psql -U postgres
```
