#!/usr/bin/env bash
# Daily SQLite backup for the Dokku app. Run from the host (cron), e.g.
#   0 4 * * * /path/to/scripts/backup.sh
set -euo pipefail

APP="${DOKKU_APP:-bookkeeping-backend}"

dokku run "$APP" sh -c '
  ts=$(date +%F_%H%M)
  mkdir -p /app/storage/backups
  sqlite3 /app/storage/production.sqlite3 ".backup /app/storage/backups/production_${ts}.sqlite3"
  find /app/storage/backups -name "*.sqlite3" -mtime +7 -delete
'
