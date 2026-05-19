# Backups — daily Postgres dumps to Cloudflare R2

The Tofu-managed `docker_container.backups` runs a self-built image based on `postgres:18-alpine` (source: `infra/backup/`) on the same `kamal` Docker network as `docker_container.postgres`. Daily it `pg_dumpall`s every database on the server (menu + zitadel + anything future), GPG-encrypts the dump with `INFRA_BACKUP_PASSPHRASE`, and uploads to the `iedora-backups` Cloudflare R2 bucket. 14-day retention. ~€0/yr at our size (R2 free tier ≤ 10 GB + zero egress).

> **Why self-built** — the canonical community image `eeshugerman/postgres-backup-s3` stops at tag `:16` upstream as of mid-2026. Postgres rejects pg_dump version mismatch outright, so a 16-client image can't dump our PG 18 server. The self-built image (~40 lines of bash + a 7-line Dockerfile based on `postgres:18-alpine`) guarantees client/server version parity. When you bump Postgres, bump the image tag in `infra/tofu/containers.tf` and run `just infra::build-backup`.

> **About the `kamal` network name** — the Docker network on the Hetzner box is still called `kamal` (declared as `docker_network.kamal` in `infra/tofu/containers.tf`). The name persists from the pre-2026-05-20 Kamal era; renaming it would force a recreate of every container on the box. Treat it as a tombstone.

## One-time setup

The infra Tofu root (`infra/tofu/`) provisions BOTH the `iedora-backups` R2 bucket AND its scoped S3 access keys via a single `cloudflare_api_token` resource — Cloudflare's R2 S3 API accepts a regular Cloudflare API token as credentials (Access Key ID = token ID, Secret = SHA-256(token value), see [docs](https://developers.cloudflare.com/r2/api/tokens/)). The values flow directly into `docker_container.backups.env`. No dashboard interaction.

Prerequisite: your existing `INFRA_CLOUDFLARE_API_TOKEN` needs **User · API Tokens · Edit** added (so Tofu can create the R2 sub-token). The other required scopes are listed in `docs/deploy.md` § Step 3.

The one value you provide yourself: `INFRA_BACKUP_PASSPHRASE` in BWS — the GPG passphrase that encrypts each dump. **Save it to your password manager** the moment you generate it. Lose the passphrase = lose the ability to decrypt past backups.

```bash
# generate once, push into BWS as INFRA_BACKUP_PASSPHRASE, copy to password manager:
bws secret create INFRA_BACKUP_PASSPHRASE "$(openssl rand -hex 32)" "$BWS_PROJECT_ID" -o none
```

Then:

```bash
just infra::build-backup  # one-off: build + push ghcr.io/$GHCR_USER/iedora-backup:18
just infra::deploy        # Tofu apply (R2 + token + every container including infra-backups)
just infra::backup        # force an immediate dump to verify end-to-end
```

`just infra::build-backup` only needs to be re-run when the Postgres major changes (bump the tag on `docker_container.backups.image` in `infra/tofu/containers.tf` to match) or when `infra/backup/*.sh` is edited.

## Forcing an on-demand backup

```bash
just infra::backup
```

This runs the dump-and-upload script immediately, in addition to the scheduled cron. Output lands in R2 with a timestamped key like `pg/all-2026-05-15T14:30:00.sql.gpg` (cluster-wide `pg_dumpall` output).

## Recovery scenarios

### Lost rows (accidental DELETE/DROP) — within 24 h

Don't whole-DB-restore over a live database. Restore into a scratch DB, surgically copy what's missing.

```bash
# 1. Spin up a scratch postgres locally:
docker run -d --name scratch-pg -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:18-alpine

# 2. Pull the latest dump from R2 (via aws-cli or rclone, or use the container):
ssh root@$ONPREM_HOST 'docker exec -it infra-backups bash'
# Inside: aws --endpoint-url=$S3_ENDPOINT s3 cp s3://$S3_BUCKET/pg/<latest>.dump.gpg /tmp/
# Decrypt: gpg --batch --passphrase=$PASSPHRASE --decrypt /tmp/<latest>.dump.gpg > /tmp/dump

# 3. Restore into scratch:
pg_restore -h localhost -p 5433 -U postgres -d postgres /tmp/dump

# 4. Pull the lost rows:
pg_dump -h localhost -p 5433 -U postgres -t <table> --data-only > rows.sql

# 5. Insert into live:
just menu::console
# Inside the app container: psql $DATABASE_URL < rows.sql
```

### Postgres data corruption — restore over fresh DB

```bash
# 1. Stop accessing the DB (or take the app offline)
INFRA_MENU_IMAGE_TAG=<known-good-sha> just infra::deploy   # roll back to last-good image

# 2. Wipe the postgres volume + boot fresh
just infra::wipe-postgres           # destroys the container + /root/infra-postgres
just infra::deploy                  # boots a fresh postgres + backups + menu

# 3. Restore latest dump
just infra::restore                 # picks the latest pg_dumpall output

# 4. Schema is at whatever the latest dump captured; the menu container's
#    boot-time `node scripts/migrate.mjs` applies any newer migrations on
#    next recreate (idempotent, pg_advisory_lock).
just infra::deploy
```

Wall-clock: ~10 min for a < 1 GB dump.

### Whole box dies (Hetzner regional outage / homelab power loss)

A new Hetzner box is one `just infra::deploy` away — Tofu provisions a fresh CAX11 from scratch via the `hcloud` provider. With the restore step:

```bash
# 1. infra::destroy            # tears down the dead box's state (skip if Hetzner already removed it)
# 2. just infra::deploy        # provisions a NEW CAX11 + boots Postgres + backups + menu in one apply
# 3. just infra::restore       # pulls latest dump from R2 into the new postgres
# 4. just infra::deploy        # re-runs apply — the menu container picks up the now-populated DB
```

Wall-clock: ~30 min. The Cloudflare DNS records repoint automatically (Tofu rewrites `cloudflare_dns_record.menu` to the new Hetzner IPv4), so user-facing hostnames stay put.

### Bad migration shipped

```bash
# Roll back to a previous image tag (~5–10s downtime; brief container recreate)
INFRA_MENU_IMAGE_TAG=<previous-good-sha> just infra::deploy

# If the migration was destructive (DROP COLUMN, etc.) and you need data back:
# follow the "lost rows" recipe above against yesterday's dump.
```

Drizzle migrations are forward-only; the migrator detects the DB schema is newer than the code's `drizzle/` dir and logs a warning but doesn't auto-down-migrate.

### Image uploads — Cloudflare R2

User-uploaded restaurant assets live in the `menu-assets` R2 bucket (separate from the `iedora-backups` bucket used here). Cloudflare R2 has built-in redundancy across edge regions, so the assets themselves don't need a separate backup pipeline — the bucket is the source of truth. To add belt-and-suspenders against accidental delete, enable Object Versioning on `menu-assets` via the Cloudflare dashboard.

If you ever want defense-in-depth (e.g. against accidental delete via a leaked R2 token), enable R2 Object Versioning on the assets bucket via the Cloudflare dashboard — adds delete markers instead of hard-deleting.

## Beyond pg_dump

If/when you outgrow daily logical dumps:

- **Sub-hour RPO** → switch the accessory to [WAL-G](https://github.com/wal-g/wal-g) or hand-roll WAL archiving. Worth it past ~50 GB or when paying customers demand it.
- **Cross-region restore** → R2 is multi-region by default; storage location set via Tofu's `backups_bucket_location` (default `EEUR` — Europe).
- **Belt-and-suspenders on Hetzner** → keep this accessory AND enable Hetzner Cloud Backups (€11/yr) for whole-VM rollback. Logical backups give granular restore; VM snapshots cover "everything else broke".
