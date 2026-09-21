# Dokku 部署（loco.rs / Rust）

App name：`bookkeeping-backend`，用 Dockerfile buildpack（multi-stage Rust build）。

## 首次設定

```bash
dokku apps:create bookkeeping-backend
dokku storage:ensure-directory bookkeeping-backend
dokku storage:mount bookkeeping-backend /var/lib/dokku/data/storage/bookkeeping-backend:/app/storage
dokku domains:set bookkeeping-backend book-api.on99.app
dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar
dokku checks:enable bookkeeping-backend
dokku checks:set bookkeeping-backend web.wait-to-retire 30
dokku checks:set bookkeeping-backend web.initial-delay 10
dokku config:set --no-restart bookkeeping-backend \
  LOCO_ENV=production \
  BINDING=0.0.0.0 \
  DATABASE_URL='sqlite:///app/storage/production.sqlite3?mode=rwc' \
  JWT_SECRET=... \
  CORS_ORIGINS=https://book.on99.app \
  LIHKG_UPLOAD_URL='https://img.eservice-hk.net/api.php?version=2' \
  LIHKG_ALLOWED_HOSTS=img.eservice-hk.net \
  DEEPSEEK_API_KEY=... \
  DEEPSEEK_MODEL=deepseek-flash \
  TZ=Asia/Hong_Kong \
  RECURRING_BACKFILL_ENABLED=false \
  RECURRING_BACKFILL_MAX_DAYS=90 \
  AI_CACHE_HOURS=24
dokku ps:scale bookkeeping-backend web=1
```

或者抄 `bin/dokku-setup.sh.example` 做 `bin/dokku-setup.sh`（已 gitignore）再改 secrets。

## 部署

```bash
git push dokku main
```

`docker-entrypoint.sh` 會先 `bookkeeping-backend-cli db migrate` 再 `start`，所以唔使另設 release process。

## 運維

- Host cron 每日跑：
  - `dokku run bookkeeping-backend ./bookkeeping-backend-cli task maintenance:cleanup`
  - `scripts/backup.sh`
- SQLite 檔案全部喺 `/app/storage`（primary：`production.sqlite3`）。
- 只有 web process，冇 worker（recurring 用 request-time catch-up）。

## 檢查

```bash
dokku logs bookkeeping-backend -t
dokku enter bookkeeping-backend web ls -la /app/storage
curl -fsS https://book-api.on99.app/up
curl -fsS https://book-api.on99.app/health
```
