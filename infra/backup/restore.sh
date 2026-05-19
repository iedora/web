#!/bin/sh
# Restore the latest (or specified) encrypted dump.
# Usage:
#   sh /restore.sh              → restore latest dump
#   sh /restore.sh <KEY>        → restore a specific S3 key (relative to bucket)
#
# Tool selection based on the dump's filename suffix:
#   *.dump.gpg  → pg_restore into POSTGRES_DATABASE (single-DB custom format)
#   *.sql.gpg   → psql at cluster level (pg_dumpall output covers every DB)
#
# Designed for interactive use:
#   just infra::restore   (wraps: ssh root@$ONPREM_HOST docker exec -it infra-backups sh /restore.sh)
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}"

if [ "${1:-}" != "" ]; then
  KEY="$1"
else
  KEY=$(aws --endpoint-url "$S3_ENDPOINT" s3api list-objects-v2 \
          --bucket "$S3_BUCKET" --prefix "${S3_PREFIX}/" \
          --query "sort_by(Contents, &LastModified)[-1].Key" \
          --output text)
  if [ -z "$KEY" ] || [ "$KEY" = "None" ]; then
    echo "[restore] no backups found in s3://${S3_BUCKET}/${S3_PREFIX}/" >&2
    exit 1
  fi
fi

echo "[restore] using s3://${S3_BUCKET}/${KEY}"
TMP=$(mktemp)
DUMP=$(mktemp)
trap 'rm -f "$TMP" "$DUMP"' EXIT

aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://${S3_BUCKET}/${KEY}" "$TMP"
gpg --batch --yes --passphrase-fd 3 --decrypt --output "$DUMP" "$TMP" 3<<EOF
$PASSPHRASE
EOF

case "$KEY" in
  *.sql.gpg)
    echo "[restore] psql cluster-wide → ${POSTGRES_HOST}"
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -f "$DUMP"
    ;;
  *.dump.gpg|*)
    if [ -z "${POSTGRES_DATABASE:-}" ]; then
      echo "[restore] error: POSTGRES_DATABASE must be set to restore a single-DB .dump.gpg" >&2
      exit 1
    fi
    echo "[restore] pg_restore into ${POSTGRES_DATABASE}@${POSTGRES_HOST}"
    pg_restore --clean --if-exists --no-owner --no-privileges \
      -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DATABASE" \
      "$DUMP"
    ;;
esac

echo "[restore] done"
