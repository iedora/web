# my-services/iedora

Iedora-specific setup. Assume que `home-infra/` já correu
(`./home-infra/scripts/bootstrap.sh`) — Beelink tem Kamal + BWS CLI +
SSH loopback key; openobserve + gitea estão up.

## 1 comando

```bash
export BWS_ACCESS_TOKEN='...'
export HOMELAB_HOST='ssh://root@<ip>'

./home-infra/my-services/iedora/scripts/bootstrap.sh
```

(pede Gitea password interactivo para criar o PAT, salvo se
`GITEA_PASSWORD` já estiver exportado)

Faz:
1. **CF tunnel + DNS** (`cf-tunnel.sh`) — cria/reusa tunnel
   `iedora-public` (apaga legacy `iedora-beelink`), ingress para
   `iedora.com`, `www`, `menu`, `core`, `imopush`. Grava
   `IEDORA_TUNNEL_TOKEN` em BWS.
2. **Cloudflared connector** (`../cloudflared/bin.sh`) — boota o
   container `iedora-public-cloudflared` na rede `homelab-core`.
3. **R2 bucket** (`r2-bucket.sh`) — bucket `iedora-assets`, S3 creds em
   BWS (`IEDORA_S3_ACCESS_KEY_ID`, `IEDORA_S3_SECRET_ACCESS_KEY`).
4. **Setup repo** (`setup-repo.sh`):
   - Cria PAT `iedora-deploy` no Gitea (via
     `home-infra/gitea/scripts/create-token.sh`, scope
     `read:repository,write:package`)
   - Publica esse PAT como Actions secret `KAMAL_REGISTRY_PASSWORD`
     (via `home-infra/gitea/scripts/set-actions-secret.sh`)
   - SSH ao Beelink: escreve `/root/.netrc` (git auth), adiciona
     `127.0.0.1 git.iedora.com` ao `/etc/hosts`, faz `git clone` (ou
     `git fetch`) de `/opt/iedora`

## BWS keys consumidas / produzidas

| Key | Operação | Lida por |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | leitura | `cf-tunnel.sh`, `r2-bucket.sh` |
| `IEDORA_TUNNEL_TOKEN` | escrita | `cloudflared/docker-compose.yml` |
| `IEDORA_S3_ACCESS_KEY_ID` | escrita | `.kamal/secrets.production` |
| `IEDORA_S3_SECRET_ACCESS_KEY` | escrita | `.kamal/secrets.production` |
| `IEDORA_AUTH_SECRET` | leitura (já existe) | `.kamal/secrets.production` |
| `IEDORA_POSTGRES_PASSWORD` | leitura (já existe) | `.kamal/secrets.production` |

## Pós-bootstrap

- Primeiro deploy: push a `main` (CI) ou `./bin/deploy` (Mac local).
- Kamal corre no Beelink (em `/opt/iedora`); pull-target = mesmo
  Beelink. Ver `docs/deploy/README.md` (a actualizar).
