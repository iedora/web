# Troubleshooting

### Kamal

| Sintoma | Causa | Recovery |
|---------|-------|----------|
| `kamal setup` / `deploy` falha com `SSH connection refused` | Beelink down ou IP mudou | Verificar `config/deploy.production.yml` + `ssh root@192.168.50.53` |
| `Access denied for 'root'` no build remoto | `ci_ed25519` key não autorizada | `ssh-copy-id -i ~/.ssh/ci_ed25519 root@192.168.50.53` |
| `unauthorized: Your request could not be authenticated by the registry` | PAT `eduvhc/kamal-ci-*` expirou/foi revogado | `./homelab-core-infra/up.sh --host ssh://root@192.168.50.53 --bootstrap-ci` (revoga PATs antigos com prefix `kamal-ci-` + cria novo + publica como Actions secret) |
| `kamal setup` cria container mas site dá 502 | connector iedora-public sem token ou caído | Re-correr `home-infra/my-services/iedora/scripts/cf-tunnel.sh` + `home-infra/my-services/iedora/cloudflared/bin.sh` |
| App crasha em boot | Migration falhou ou env em falta | `ssh docker logs iedora-web --tail 100` |
| Hot-swap falha | Healthcheck não passa | `kamal deploy` não mata o container atual. `ssh docker logs iedora-web --tail 50` para ver o erro |
| `kamal-proxy` não arranca | Porta 3001 ocupada | `lsof -i :3001` no Beelink |

### Cloudflare Tunnels (2: iedora-public + homelab-admin)

`iedora-public` (anónimo, iedora.com + subdomínios): provisionado por `home-infra/my-services/iedora/scripts/cf-tunnel.sh`, connector em `home-infra/my-services/iedora/cloudflared/`.

`homelab-admin` (gitea + openobserve, sign-in nativo da app): provisionado por `home-infra/cloudflared/scripts/provision.sh`, connector em `home-infra/cloudflared/`.

| Sintoma | Causa | Recovery |
|---------|-------|----------|
| Site público 502 com tunnel `Connected` | Ingress aponta para porta errada | Verificar `SERVICE_TARGET` em `cf-tunnel.sh` |
| DNS não propaga | TTL em cache | `curl -sI https://menu.iedora.com` esperar 5min |
| Token inválido | Foi regenerado do lado CF | Re-correr o `cf-tunnel.sh` ou `provision.sh` do tunnel afectado |
| Kamal pull falha com 403/401 no registry | Kamal usa `:4443` via /etc/hosts loopback, NÃO o tunnel | Verificar Caddy local em :4443 + `.netrc` |

### OpenObserve

| Sintoma | Causa | Recovery |
|---------|-------|----------|
| OTel spans não aparecem | OO não está a receber | `ssh root@... docker logs openobserve --tail 20` |
| OO UI não abre | Container parado | `./homelab-core-infra/up.sh --host ssh://root@192.168.50.53` |
| App não consegue conectar a OO | `host.docker.internal` não resolvido | Verificar `add-host: host.docker.internal:host-gateway` em `config/deploy.production.yml` |

### Postgres

| Sintoma | Causa | Recovery |
|---------|-------|----------|
| App dá `connection refused` ao postgres | Postgres accessory não está up | `kamal accessory boot postgres -d production` |
| `role "postgres" does not exist` | Volume postgres corrompido | `kamal accessory reboot postgres -d production` |
| DB `menu` / `core` não existe | init.sql não correu (volume já existia) | Criar manualmente: `docker exec ... psql -U postgres -c "CREATE DATABASE menu;"` |
