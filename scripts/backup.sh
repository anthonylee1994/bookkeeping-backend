#!/usr/bin/env bash
set -euo pipefail

APP="${APP:-bookkeeping-backend}"
dokku run "$APP" sh -c '
  set -eu
  ts=$(date +%F_%H%M)
  mkdir -p /app/storage/backups
  for db in production production_cache; do
    sqlite3 "/app/storage/${db}.sqlite3" ".backup /app/storage/backups/${db}_${ts}.sqlite3"
  done
  find /app/storage/backups -name "*.sqlite3" -mtime +7 -delete
'
