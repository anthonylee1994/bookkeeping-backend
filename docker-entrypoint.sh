#!/bin/sh
set -e

echo "==> normalizing legacy sqlite column types"
node dist/tasks/normalize-sqlite-types.js

echo "==> running migrations"
# The init migration uses `CREATE TABLE/INDEX IF NOT EXISTS`, so a pre-existing
# (Rails / loco.rs / Prisma) database is picked up as-is and the migration is
# simply recorded as applied — no baseline step needed.
node dist/tasks/migrate.js

echo "==> starting server"
exec node dist/main.js
