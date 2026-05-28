# Day 0 — Bootstrap do homelab

> Provisionar tudo o que é preciso antes do primeiro `kamal deploy`.

## Pré-requisitos

- Docker instalado no homelab (Beelink, NUC, Mac mini, etc.)
- SSH key do operador autorizada no homelab (`~/.ssh/ci_ed25519`)
- `BWS_ACCESS_TOKEN` exportado na shell
- BWS contém: `CLOUDFLARE_API_TOKEN` (com Tunnel + DNS + R2 scope)

## 1. Configurar Kamal para o IP do homelab

Em `config/deploy.production.yml`, alterar `servers.web.hosts[0]` para
o IP LAN do novo homelab.

## 2. Cloudflare Tunnel

```bash
./infra-bootstrap/cloudflare-tunnel.sh
```

Cria tunnel `iedora-beelink`, ingress para 5 hostnames, CNAMEs na zona.
Guarda `IEDORA_TUNNEL_TOKEN` em BWS. Idempotente.

## 3. R2 bucket

```bash
./infra-bootstrap/r2-bucket.sh
```

Bucket `iedora-assets` + token S3 scoped. Grava
`IEDORA_S3_ACCESS_KEY_ID` e `IEDORA_S3_SECRET_ACCESS_KEY` em BWS.

## 4. homelab-core-infra (OpenObserve)

```bash
./homelab-core-infra/up.sh --host ssh://root@192.168.50.53
```

Boot OpenObserve no homelab. Credenciais admin de BWS.

## 5. Verificar BWS keys

```bash
bws secret list "$(bws project list -o json | jq -r '.[0].id')" -o json | jq -r '.[].key' | sort
```

Devem existir: `GITEA_REGISTRY_TOKEN`, `IEDORA_TUNNEL_TOKEN`,
`IEDORA_S3_ACCESS_KEY_ID`, `IEDORA_S3_SECRET_ACCESS_KEY`,
`IEDORA_POSTGRES_PASSWORD`, `IEDORA_AUTH_SECRET`,
`CLOUDFLARE_API_TOKEN`, `OPENOBSERVE_ADMIN_PASSWORD`.

## Seguinte

`kamal setup -d production` — ver [`day-1.md`](day-1.md).
