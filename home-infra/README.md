# home-infra

Infra base do homelab — services independentes do produto (iedora vai
para `home-infra/iedora/` depois).

## Convention

Cada service tem:

```
home-infra/<service>/
  bin.sh              # entrypoint (sem flags; usa DOCKER_HOST para remote)
  docker-compose.yml  # compose isolado, network `homelab-core` external
  scripts/            # auxiliares idempotent
```

`bin.sh` faz fetch de secrets do BWS para `.env` local, garante a
network `homelab-core`, e corre `docker compose up -d`.

Para remote: `DOCKER_HOST=ssh://root@<host> ./bin.sh`.

## Services

| Service | Conteúdo | Porta(s) |
|---|---|---|
| `openobserve/` | OpenObserve (logs/traces/metrics) | 5080 (UI/OTLP HTTP), 5081 (OTLP gRPC) |
| `gitea/` | Gitea (git+UI+Actions+registry OCI) + Caddy (TLS git.iedora.com) + runner | 3030 (UI), 3022 (SSH), 4443 (HTTPS via Caddy) |

## Ordem de boot

Não há `depends_on` cross-compose. Para um homelab novo:

```bash
DOCKER_HOST=ssh://root@<host> ./openobserve/bin.sh
DOCKER_HOST=ssh://root@<host> ./gitea/bin.sh
```

Ou local:

```bash
./openobserve/bin.sh  # (compose up -d com docker local)
./gitea/bin.sh
```

## Volumes

Os volumes estão marcados `external: true` com os nomes existentes
(`homelab-core-infra_*`) para preservar dados da config anterior.
Para um homelab novo, remover `external: true` para criar de raiz.
