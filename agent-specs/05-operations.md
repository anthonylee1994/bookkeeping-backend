# 6. 環境變數範例

```bash
# Runtime environment
NODE_ENV=production

# Server
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# DB（SQLite 喺 /app/storage；`../` 開頭路徑沿用舊 Prisma 解析）
DATABASE_URL=file:../storage/production.sqlite3

# Auth
JWT_SECRET=...

# CORS
CORS_ORIGINS=https://book.on99.app

# 上傳
LIHKG_UPLOAD_URL=https://img.eservice-hk.net/api.php?version=2
LIHKG_ALLOWED_HOSTS=img.eservice-hk.net
MAX_UPLOAD_BYTES=10485760
LIHKG_CIRCUIT_FAILURES=5
LIHKG_CIRCUIT_COOLDOWN=60

# AI
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_VISION_ENABLED=true
AI_CACHE_HOURS=24

# 業務
TZ=Asia/Hong_Kong
RECURRING_BACKFILL_ENABLED=false
RECURRING_BACKFILL_MAX_DAYS=90
```

> Dev/test 用 `dotenv` load 專案根目錄 `.env` / `.env.test`（`src/main.ts` 頂部 `import 'dotenv/config'`）。Prod 用 `dokku config:set`。`DATABASE_URL` 係 SQLite 路徑：`resolveDatabasePath()`（`src/database/data-source-options.ts`）解析——`file:../...` 開頭沿用舊 Prisma 相對 `prisma/schema.prisma` 嘅規則（所以現有值唔使改，仍然指向 repo `storage/` / container `/app/storage`），其他相對路徑就相對 cwd（repo root）。

---

# 7. 統一錯誤格式

```json
{
    "error": {
        "code": "validation_error",
        "message": "Amount can't be blank",
        "details": {"amount_cents": ["can't be blank"]},
        "request_id": "abc-123"
    }
}
```

常見 code：`unauthorized`, `invalid_credentials`, `invalid_current_password`, `not_found`, `validation_error`, `rate_limited`, `upstream_error`, `idempotency_conflict`, `account_in_use`, `already_materialized`

`render_error` 會喺 `details` 有值時先加 `details`；`request_id` 一律附上。

`request_id` 由 `src/common/request-id.ts` middleware 產生（讀入 `X-Request-Id`，否則新 UUID），用 Node `AsyncLocalStorage` 傳畀 `ApiError`，並喺 response 加返 `X-Request-Id` header。所有未被 catch 嘅 exception 由 `src/common/error.filter.ts`（global `ApiExceptionFilter`）統一渲染成上面嘅 envelope。

---

# 8. 分頁格式

```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 132,
    "total_pages": 6
  }
}
```

`per_page` clamp 1..100（預設 25）。

---

# 9. Dokku 部署 Checklist

- [ ] `Dockerfile` multi-stage Node build，`EXPOSE 3000`，CMD 跑 `docker-entrypoint.sh`
- [ ] `docker-entrypoint.sh` 先 `node dist/tasks/normalize-sqlite-types.js`（修正舊 DB declared type）再 `node dist/tasks/migrate.js`（TypeORM migration；init migration 用 `IF NOT EXISTS`，舊 DB 直接接軌）再 `node dist/main.js`
- [ ] 由舊 Rails/loco DB 升級：entrypoint 會自動 normalize `datetime(6)` / `date` 欄位；但 normalize 會改 schema，deploy 前**必須先停舊 container**（SQLite DDL 要 write lock；而且如果同時有 live connection，`writable_schema` rewrite 會令佢個 connection 出 `SQLITE_CORRUPT`）
- [ ] `dokku storage:mount` 將 `/app/storage` 掛出去
- [ ] `dokku config:set` 所有 ENV（見 #6）
- [ ] `dokku domains:set bookkeeping-backend book-api.on99.app`
- [ ] `dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar`
- [ ] `dokku checks:enable` + `web.wait-to-retire 30` + `web.initial-delay 10`
- [ ] `dokku ps:scale bookkeeping-backend web=1`（**冇 worker**）
- [ ] Host cron 每日跑 backup + `node dist/tasks/maintenance.js`
- [ ] `dokku logs` 確認冇 error
- [ ] `dokku enter bookkeeping-backend web ls -la /app/storage` 見到 `production.sqlite3`
- [ ] `dokku enter bookkeeping-backend web ls -la /app/storage/backups` 見到 backup

---

# 10. 未確定事項 / 風險

1. **DeepSeek vision 已 GA**：`deepseek-flash` 原生支援 image input（base64 / URL / file_id）。單張圖最多 384 tokens。
2. **LIHKG API 非官方**：`img.eservice-hk.net` 冇 SLA、冇文檔；出站 upload **必須** `Origin: https://lihkg.com`。已加自建 circuit breaker，但要有 fallback 圖床（S3 / R2）嘅 plan。
3. **SQLite 併發**：得 web process 寫；WAL + busy_timeout 仍然要（`TypeOrmModule` 用 `enableWAL` + `prepareDatabase`：busy_timeout=5000、synchronous=NORMAL、foreign_keys=ON）。Catch-up 喺 read request 寫入，單 user 可接受；高負載要轉 Postgres（改 TypeORM `type` + `DATABASE_URL`，日期欄位改回 native DateTime）。
4. **JWT 永久有效**：唔寫、唔驗證 `exp`；冇 UserSession，server **唔能** revoke 單張 token。遺失 token 要 rotate `JWT_SECRET`。
5. **Dokku storage 單點**：冇 replication，靠 backup。
6. **多貨幣**：而家只 HKD，將來加外幣要 exchange rate service。
7. **Transfer 報表**：spec 只定義 summary 有 `transfers` key。
8. **Recurring catch-up**：user 唔打 API 就唔會產生交易（故意）。Backfill 預設關閉；90 日上限係假設。
9. **Hard delete 唔可還原**：刪交易真係唔見；刪分類 / 商家只 nullify FK。帳戶有交易就刪唔到。
10. **圖片 URL 持久性**：LIHKG URL 可能過期，將來要考慮 re-host 到 S3 / R2。
11. **密碼 hash**：新密碼用 bcryptjs（`$2a$` / `$2b$`）；舊 Rails `$2a$` hash 直接 verify 得，無需 data migration。
12. **日期欄位 affinity**：TypeORM 唔似 Prisma 咁按 DB declared type 解碼，entity 型別係 `string` 就直接讀 TEXT 值，所以舊 Rails/loco DB 嘅 `datetime(6)` / `date` 欄位其實讀得到。`docker-entrypoint.sh` 仍然會行 `dist/tasks/normalize-sqlite-types.js`（本機等同 `pnpm db:normalize`），用 `better-sqlite3` `unsafeMode` + `PRAGMA writable_schema` 將 declared type in-place 改成 `varchar`，保留所有 data，可重複執行（re-run 會係 0 改動）。實作會跳過舊 Prisma 內部 `_prisma_migrations` 表。**呢個改動絕對唔可以喺 live server 開住嗰陣跑**：`writable_schema` 改 `sqlite_master` 會令其他已開嘅 connection 出 `SQLITE_CORRUPT`（即使檔案本身冇壞）。一定要先停 server。
13. **Legacy DB baseline**：舊 DB 有 table 但冇 migration history——TypeORM init migration 全部用 `CREATE TABLE/INDEX IF NOT EXISTS`，會當 schema 已存在、直接記錄 migration 為 applied，冇 Prisma 年代嘅 P3005 baseline 問題。
14. **金額欄位 32-bit 假設**：`amount_cents` / `initial_balance_cents` 應用層當 32-bit 整數（`parseI32Field` 夾 -2^31..2^31-1）。SQLite 本身係 64-bit，legacy DB 可能有超出範圍嘅值；修改／新寫入會經應用層驗證，讀取就照原值返回。
15. **AI JSON schema 嚴格度**：太嚴會令 partial 增加，太鬆會入錯數，要 collect 真實數據再 tune。
16. **AI cache 簽名**：`parse_signature` 綁定 `PROMPT_VERSION` 同 user 分類名單；改名／加減分類或 bump prompt 都會 miss cache。

---

# 附錄 A：DeepSeek Vision Request（NestJS）

實作：`src/ai/deepseek.service.ts`。

```jsonc
// POST {DEEPSEEK_BASE_URL}/chat/completions
{
    "model": "deepseek-flash",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "<prompt + user categories>"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}},
            ],
        },
    ],
    "response_format": {"type": "json_object"},
}
```

回傳用括號平衡掃描抽 JSON object（揀最有 `amount_cents` 特徵嗰個），再手寫 schema 驗證；唔過就 `status = partial` 並保留 `raw_response` / `error_message`。
