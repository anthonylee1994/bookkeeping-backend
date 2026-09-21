#!/bin/sh
set -e

echo "==> running migrations"
/app/bookkeeping-backend-cli db migrate

echo "==> starting server"
exec /app/bookkeeping-backend-cli start
