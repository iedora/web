# Day 1 — Primeiro deploy

> Depois do bootstrap (day 0), `kamal setup` provisiona tudo.

```bash
export BWS_ACCESS_TOKEN=0.…  # de ~/.secrets

kamal setup -d production
```

## O que `kamal setup` faz

1. Instala `kamal-proxy` no host (se não existir)
2. Cria a rede Docker `kamal`
3. Corre `docker compose up` para postgres (accessory) + cloudflared
4. Faz build da imagem via builder remoto (SSH para o Beelink)
5. Push para `git.iedora.com/eduvhc/web:latest`
6. Boot kamal-proxy na porta 3001 (publishes app:3000)
7. Boot iedora-web (healthcheck `/up`)
8. Espera healthcheck — pronto

## Verificar

```bash
curl -sI https://menu.iedora.com/up       # → HTTP/2 200
curl -sI https://core.iedora.com            # → HTTP/2 200
curl -sI https://iedora.com                 # → HTTP/2 200
```

No Beelink:

```bash
ssh root@192.168.50.53 docker ps
# Esperado: iedora-web, iedora-web-postgres, cloudflared, kamal-proxy
```

## Troubleshooting

- `kamal setup` falha no build remoto → verificar `~/.ssh/ci_ed25519`
  e `ssh://root@192.168.50.53`
- Tunnel não conecta → `./infra-bootstrap/cloudflare-tunnel.sh`
  re-grava o token
- Postgres não arranca → `ssh root@... docker logs iedora-web-postgres`
