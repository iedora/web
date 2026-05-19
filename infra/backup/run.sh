#!/bin/sh
# Daemon: run backup.sh on a fixed interval. Crashes the container on failure
# so Docker restarts it (visible in `just infra::logs backups`).
set -eu

: "${SCHEDULE:=@daily}"
case "$SCHEDULE" in
  @daily)   INTERVAL=86400 ;;
  @hourly)  INTERVAL=3600 ;;
  @weekly)  INTERVAL=604800 ;;
  *)
    # Numeric seconds, e.g. SCHEDULE=3600 for 1h.
    if echo "$SCHEDULE" | grep -qE '^[0-9]+$'; then
      INTERVAL="$SCHEDULE"
    else
      echo "Unsupported SCHEDULE: $SCHEDULE (use @daily/@hourly/@weekly or seconds)" >&2
      exit 1
    fi
    ;;
esac

echo "[run] schedule=${SCHEDULE} (interval=${INTERVAL}s)"

# Sleep first so a freshly-booted container doesn't immediately back up.
sleep "$INTERVAL"
while true; do
  /backup.sh || echo "[run] backup failed; will retry next cycle"
  sleep "$INTERVAL"
done
