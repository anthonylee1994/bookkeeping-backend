# Dokku setup

Placeholder runbook for deploying `bookkeeping-backend` to Dokku.

Do **not** put secrets in this file. Copy `bin/dokku-setup.sh.example` to
`bin/dokku-setup.sh` (gitignored) or write machine-specific notes in
`docs/dokku-setup.local.md` (also gitignored).

## App

- App name: `bookkeeping-backend`
- Domain: `book-api.on99.app`
- Process: web only (no worker)
- SQLite files: `/app/storage` (Dokku storage mount)

## One-time host commands

```bash
dokku apps:create bookkeeping-backend
dokku storage:ensure-directory bookkeeping-backend
dokku storage:mount bookkeeping-backend /var/lib/dokku/data/storage/bookkeeping-backend:/app/storage
dokku domains:set bookkeeping-backend book-api.on99.app
dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar
dokku checks:enable bookkeeping-backend
dokku checks:set bookkeeping-backend web.wait-to-retire 30
dokku checks:set bookkeeping-backend web.initial-delay 10
dokku config:set bookkeeping-backend \
  RAILS_ENV=production \
  RAILS_MASTER_KEY=... \
  SECRET_KEY_BASE=... \
  JWT_SECRET=... \
  CORS_ORIGINS=https://app.on99.app \
  LIHKG_UPLOAD_URL=https://img.eservice-hk.net/api.php?version=2 \
  LIHKG_ALLOWED_HOSTS=img.eservice-hk.net \
  DEEPSEEK_API_KEY=... \
  DEEPSEEK_MODEL=deepseek-flash \
  DEEPSEEK_VISION_ENABLED=true \
  TZ=Asia/Hong_Kong \
  RECURRING_BACKFILL_ENABLED=false \
  RECURRING_BACKFILL_MAX_DAYS=90 \
  AI_CACHE_HOURS=24
dokku ps:scale bookkeeping-backend web=1
```

## Deploy

From this repo:

```bash
git remote add dokku dokku@<host>:bookkeeping-backend
git push dokku main
```

`Procfile` `release` runs `db:prepare` + `db:migrate`. Health check is `GET /up`.

## Verify

```bash
dokku storage:list bookkeeping-backend
dokku enter bookkeeping-backend web ls -la /app/storage
# expect production.sqlite3 + production_cache.sqlite3
curl -fsS https://book-api.on99.app/up
```

## Host cron (Phase 7)

Backup + idempotency cleanup are host cron, not an in-app worker. See Phase 7
in `BACKEND-SPEC.md` when implementing maintenance.
