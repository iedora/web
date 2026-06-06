# infra/tofu/r2 — Cloudflare R2 (bucket + creds)

Infra externa que a app `iedora-web` precisa para funcionar (uploads).
Vive aqui, junto ao código, e não no [`homelab-iac`](https://github.com/eduvhc/homelab-iac)
(esse é homelab-only — agnóstico de apps).

## O que gere

| Recurso | Para quê |
|---|---|
| `cloudflare_r2_bucket.assets` | Bucket `iedora-assets` para uploads |
| `cloudflare_r2_bucket_cors.assets` | CORS — PUT/POST directo dos domínios |
| `cloudflare_api_token.assets_rw` | Token bucket-scoped → creds S3 para a app |

State backend: bucket `homelab-iac-state` do homelab (criado por
`homelab-iac/tools/seed-secrets.sh`), key `iedora-web/r2/terraform.tfstate`.

## Workflow

Pré-req único: ter o repo `homelab-iac` em `~/projects/personal/homelab-iac`,
a age key em `~/.config/sops/age/keys.txt`, e correr `tools/seed-secrets.sh`
uma vez. Sops + age têm de estar no PATH.

```bash
cd ~/projects/personal/iedora/infra/tofu/r2
. ../.envrc                    # auto-source via direnv quando instalado
tofu init
tofu apply

# Outputs → apps/web/.env.prod
cd ~/projects/personal/iedora
bun prod:env:edit
# cola:
#   S3_ENDPOINT=$(tofu -chdir=infra/tofu/r2 output -raw s3_endpoint)
#   S3_BUCKET=$(tofu -chdir=infra/tofu/r2 output -raw s3_bucket)
#   S3_REGION=auto
#   S3_ACCESS_KEY=$(tofu -chdir=infra/tofu/r2 output -raw s3_access_key_id)
#   S3_SECRET_KEY=$(tofu -chdir=infra/tofu/r2 output -raw s3_secret_access_key)

# Coolify UI → iedora-web → Environment Variables → re-cola as 5 (se já as
# tinhas; senão paste new).

git add infra/tofu/r2/ apps/web/.env.prod
git commit -m 'infra(r2): apply + update app secrets'
git push
```

## Rotar credenciais

```bash
cd ~/projects/personal/iedora/infra/tofu/r2 && . ../.envrc
tofu apply -replace=cloudflare_api_token.assets_rw
# Repete passo das outputs + Coolify UI acima.
```

O bucket e os ficheiros nele não são tocados.

## Onde isto se encaixa

```
~/projects/personal/
├── homelab-iac/          ← platform (LXCs, tunnel, Coolify install, state bucket)
│   ├── secrets.sops.yaml ← encrypted, committed (single source of truth)
│   └── tools/lib/common.sh ← expõe source_envrc
└── iedora/               ← app
    ├── apps/web/
    │   └── .env.prod     ← app secrets (sops, committed)
    └── infra/tofu/
        ├── .envrc        ← committed: sources $HOMELAB_IAC_ROOT/tools/lib/common.sh + source_envrc
        └── r2/           ← este stack
```

Cross-repo dep contida no `infra/tofu/.envrc` — uma linha que delega tudo
ao homelab-iac (`HOMELAB_IAC_ROOT` é override para layouts diferentes).
