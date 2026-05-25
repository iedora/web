#!/usr/bin/env bash
# Pre-create the buckets prod has on R2: `iedora-data` (private —
# backups + OO cold tier) + `iedora-assets` (public — menu uploads).
# Runs once when LocalStack reports ready; idempotent on warm restarts.
set -euo pipefail

awslocal s3 mb s3://iedora-data || true
awslocal s3 mb s3://iedora-assets || true
