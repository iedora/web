# Postgres backup image — pg_dump version locked to the server it backs up.
# eeshugerman/postgres-backup-s3 (the canonical Kamal pattern) stops at :16
# as of 2026; we run postgres:18-alpine, and pg_dump enforces version parity.
# Tiny self-built image is the durable fix. Pin to the same point release
# the postgres accessory uses — CVE-2025-8715 (pg_dump newline → RCE on
# restore) is fixed in 18.2+.
#
# Build + push manually via `make build-backup` (Makefile target). Versioning
# follows the postgres major in `config/deploy.yml` — when you bump postgres,
# bump the image tag here too.
FROM postgres:18.4-alpine

RUN apk add --no-cache aws-cli gnupg tini

COPY run.sh backup.sh restore.sh /
RUN chmod +x /run.sh /backup.sh /restore.sh

# Links the GHCR package to its source repo. Same convention as products/*/Dockerfiles.
LABEL org.opencontainers.image.source="https://github.com/eduvhc/iedora"

# pg_dump + aws-cli + gpg don't need root. The postgres base image already
# ships a `postgres` user (uid 70 in Alpine). Drop privileges so a script
# bug or a malicious dump can't write to anywhere the base image protects.
USER postgres

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/run.sh"]
