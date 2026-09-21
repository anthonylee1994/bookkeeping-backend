# 5. Phases

### Phase 0：專案初始化 + Dokku 準備

**目標**：Rails 8 API-only 骨架、Dokku app、SQLite persistent storage。

**任務**

- [x] `rails new bookkeeping_api --api --database=sqlite3 --skip-test --skip-action-mailer --skip-action-mailbox --skip-action-text --skip-active-storage`
- [x] 加 gem：`bcrypt`, `jwt`, `rack-cors`, `rack-attack`, `pagy`, `rswag`, `dotenv-rails`(dev), `bullet`(dev/test), `rspec-rails`, `factory_bot_rails`, `webmock`, `vcr`, `faraday`, `faraday-retry`, `faraday-multipart`, `stoplight`, `json-schema`, `lograge`
- [x] **唔裝**：`discard`、Solid Queue、Solid Cable
- [x] `config/application.rb`：
  - `config.time_zone = "Asia/Hong_Kong"`
  - `config.active_record.default_timezone = :local`
  - `config.middleware.insert_after ActionDispatch::RequestId, ActionDispatch::RequestId`
- [x] `config/initializers/cors.rb`：origin 由 `ENV["CORS_ORIGINS"].split(",")` 讀
- [x] `config/initializers/rack_attack.rb`：login 5/min/IP、改密碼 5/min/user、AI 10/min/user、upload 20/min/user
- [x] `config/initializers/pagy.rb`：`Pagy::DEFAULT[:max_per_page] = 100`
- [x] `config/initializers/sqlite_uuid.rb`：將 `:uuid` map 做 `varchar(36)`（SQLite 冇 native UUID）
- [x] `config.generators`：`g.orm :active_record, primary_key_type: :uuid`
- [x] `ApplicationRecord`：
  - `before_create`：`self.id ||= SecureRandom.uuid`
  - `self.implicit_order_column = "created_at"`
- [x] `config/database.yml`：2 個 DB（primary / cache）全部指向 `storage/`
- [x] SQLite WAL：`config/initializers/sqlite_pragma.rb`

```ruby
Rails.application.config.after_initialize do
  ActiveRecord::Base.connection_pool.with_connection do |conn|
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
  end
end
```

- [x] Solid Cache 安裝（唔裝 Queue / Cable）：

```bash
bin/rails solid_cache:install
```

- [x] `Dockerfile`（Rails 8 預設，`EXPOSE 3000`）
- [x] `Procfile`：

```
web: bundle exec puma -C config/puma.rb
release: bundle exec rails db:prepare && bundle exec rails db:migrate
```

- [x] `docs/dokku-setup.md`（純文檔，placeholder）
- [x] `.gitignore` 加 `bin/dokku-setup.sh`、`docs/dokku-setup.local.md`
- [x] `bin/dokku-setup.sh.example`（範本）

**Dokku setup 範例**（`docs/dokku-setup.md`）：

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
  CORS_ORIGINS=https://book.on99.app \
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

**驗收**

- [x] `rails s` 起得
- [x] `git push dokku main` 成功 build
- [x] `/up` 回 200
- [x] `dokku storage:list bookkeeping-backend` 見到 mount
- [x] `dokku enter bookkeeping-backend web ls -la /app/storage` 見到 primary + cache sqlite 檔
- [x] generators `primary_key_type: :uuid`；SQLite `native_database_types[:uuid]` = `varchar(36)`
- [x] `create_table ..., id: :uuid` 建出嚟嘅 PK 係 UUID string，唔係 integer

---

### Phase 1：User / Auth / JWT

**目標**：註冊、登入、JWT 簽發驗證。冇 session 表、冇 server-side logout。

**任務**

- [x] Migration：User（2.1），`create_table :users, id: :uuid`
- [x] `User` model：`has_secure_password`、username 轉 lowercase、password 最少 8 字、**冇 email**
- [x] `JsonWebToken` service：
  - `encode(user_id)`：用 `JWT_SECRET`；payload 含 `user_id`（UUID string）/ `iat`，**唔寫** `exp`**、唔寫** `jti`
  - `decode(token)`：`JWT.decode(token, secret, true, { verify_expiration: false, algorithm: "HS256" })`
- [x] `ApplicationController`：
  - `authenticate_user!` before_action
  - 解析 `Authorization: Bearer <token>`
  - decode 後 `User.find(payload["user_id"])`；user 唔存在 → 401
  - `catch_up_recurring` before_action 喺 Phase 4 先加
- [x] `AuthController`：register / login（**冇 logout**）
- [x] login：簽發 JWT，**唔**寫任何 session row
- [x] Rate limit login（Rack::Attack）

**API 範例**

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "username": "alice", "password": "secret123" }
```

```json
{
  "data": {
    "token": "eyJ...",
    "user": {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "username": "alice"
    }
  }
}
```

**驗收**

- [x] 錯誤密碼回 401 + `{ "error": { "code": "invalid_credentials" } }`
- [x] 無 token 打 `/me` 回 401
- [x] 壞 token / 亂簽 token 打 `/me` 回 401
- [x] 兩個裝置用同一 token 都 work
- [x] **冇** `DELETE /auth/logout`、**冇** `/sessions`（回 404）
- [x] register / login **唔收** email；`User` **冇** email 欄位
- [x] `Alice` 同 `alice` 視為同一個 username（lowercase）
- [x] register / login 回嘅 `user.id` 係 UUID string（36 chars），唔係 integer

---

### Phase 2：Account / Category / Merchant

**任務**

- [x] Migrations（2.2 / 2.3 / 2.4）：全部 `id: :uuid`；FK 一律 `type: :uuid`
- [x] User 註冊後 `after_create` callback 建立：
  - 「現金」Account（kind=cash，color `#ecf0f1`，icon `mdi:cash`）
  - 預設分類（每個都有 color `#ecf0f1` 同對應 `mdi:*` icon）：
    - Expense：飲食、交通、娛樂、購物、醫療、住屋、水電、其他支出
    - Income：薪水、獎金、投資、兼職、其他收入
- [x] Account / Category / Merchant controller CRUD + hard delete
  - Category / Merchant：delete 時 FK nullify
  - Account：有交易（含 transfer 目標）或 RecurringRule → 422 `account_in_use`
- [x] Merchant autocomplete：`GET /merchants?q=`，回 top 10（`usage_count` 降序、`name` 升序），SQLite `LIKE`；無 `q` 時回傳全部（商戶管理頁用）
- [x] Merchant update：可改 `name` / `default_category_id`（default category 必須屬同一 user）
- [x] 所有 query scope 到 `current_user`

**驗收**

- [x] 新 user 登入後 `GET /accounts` 見到「現金」
- [x] 刪分類後 `GET /categories` 唔見，但舊交易仍顯示 category_id = null
- [x] 帳戶有交易時 DELETE 回 422 `account_in_use`
- [x] 打其他人 category id 回 404
- [x] 預設分類冇一個叫「收入」（避免同 kind=income 混淆）

---

### Phase 3：Transaction CRUD + Idempotency

**任務**

- [x] Migration：Transaction（2.5）、IdempotencyKey（2.9）：全部 `id: :uuid`；FK 一律 `type: :uuid`
- [x] `Transaction` model：enum kind / source、validation（ownership）、scope、`by_user`
- [x] `TransactionsController`：index（filter + sort + offset/limit）、create、show、update、destroy（hard delete）
- [x] Idempotency（controller concern，`POST /transactions` 同 `/ai/confirm`）：
  - 讀 `Idempotency-Key` header
  - 查 IdempotencyKey table
  - 若存在且 `created_at > 24.hours.ago`：`request_hash` 相同 → replay response；唔同 → 422 `idempotency_conflict`
  - 否則執行 request，寫入 IdempotencyKey
  - 過期 key 由 host cron `rails maintenance:cleanup` 每日清 > 24 小時
- [x] 建立時：`increment!(:usage_count)` 對應 merchant
- [x] `POST /transactions/:id/duplicate`：複製欄位，`occurred_at = now`
- ~~`POST /transactions/:id/refund`~~：**2026-09-15 移除**（`refund_of_id` migration 已 drop）

**Filter 參數**

```
?from=2026-09-01&to=2026-09-30
&kind=expense
&category_id=9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
&account_id=3fa85f64-5717-4562-b3fc-2c963f66afa6
&merchant_id=1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
&q=starbucks
&min_amount=1000&max_amount=50000
&sort=-occurred_at
&page=1&per_page=25
```

**驗收**

- [x] 建立 transfer 時 category_id 必須 nil
- [x] 同 `Idempotency-Key` 打兩次只建一筆
- [x] 打其他人 transaction id 回 404
- [x] 刪交易後 `GET /transactions` 真係冇嗰筆（hard delete）
- [x] 同 key 但 body 唔同回 422 `idempotency_conflict`
- [x] `q` 搵得到 merchant name（`left_joins(:merchant)` + `merchants.name LIKE`）
- [x] Bullet 冇 N+1 warning

---

### Phase 4：RecurringRule + request-time catch-up

**任務**

- [x] Migration（2.6 / 2.7）：全部 `id: :uuid`；FK 一律 `type: :uuid`
- [x] `RecurringRule` model：validation、`next_run_at` 計算、hard delete
- [x] `RecurringRuleCalculator` service：
  - `next_occurrence(from:, rule:)` 支援 daily/weekly/monthly/yearly + interval
  - 月末邊界處理（31 號 → 當月最後一日）
- [x] `RecurringCatchUp` service（**唔用 job**）：
  - `call(user:)` 掃該 user `status = active` 且 `next_run_at <= now`
  - 包 `Time.use_zone("Asia/Hong_Kong")`
  - 用 `RecurringOccurrence` unique index 保證 idempotent；撞 unique → rescue 當已處理
  - 建立 Transaction，`source = recurring`
  - 更新 `last_run_at` / `next_run_at`
  - 若 `end_on` 過 → `status = ended`
  - **Backfill 邏輯**：
    - `RECURRING_BACKFILL_ENABLED=false`：只產生今日一筆，中間 occurrence 寫 RecurringOccurrence 但 `transaction_id = nil`
    - `RECURRING_BACKFILL_ENABLED=true`：補最多 `RECURRING_BACKFILL_MAX_DAYS` 日，超過 skip 並 log warning
- [x] `ApplicationController`（已 authenticate）`before_action :catch_up_recurring`
  - 跳過：AuthController、HealthController
- [x] Controller：CRUD + pause / resume / run_now / skip_next
  - `run_now`：該 `occurred_on` 未有 transaction 就補建；已有 → 409 `already_materialized`
  - `skip_next`：寫 RecurringOccurrence（`transaction_id = nil`）並推進 `next_run_at`

**驗收**

- [x] 建立 daily rule，`run_now` 後見到 transaction
- [x] 同一 occurrence catch-up 兩次（或兩個並行 request）唔會重複
- [x] 唔打 API 嘅期間 **唔會**自己產生交易（冇 worker）
- [x] **Backfill 關閉**：3 日冇 request 之後再 GET `/dashboard`，只補今日一筆
- [x] **Backfill 開啟**：3 日冇 request 之後再 GET `/dashboard`，補返 3 筆
- [x] 刪一筆 `source=recurring` 交易後再 catch-up，**唔會**再生該日
- [x] 31 號 monthly rule，2 月只產生 1 筆喺 2 月最後一日
- [x] `end_on` 過後 status = ended，唔再產生

---

### Phase 5：LIHKG Upload / DeepSeek Vision（冇 Attachment）

**任務**

- [x] Migration：AiImportLog（2.8）：`id: :uuid`；FK 一律 `type: :uuid`
- [x] `LihkgUploadService`：
  - endpoint 由 `ENV["LIHKG_UPLOAD_URL"]` 讀
  - multipart form，field name `file`
  - 出站 header **必須** `Origin: https://lihkg.com`（硬編碼；圖床會 check，唔係呢個 Origin 會拒。**唔好**用我哋自己 API 嘅 CORS origin）
  - 驗證 magic number（`marcel` gem）
  - 大小上限 `MAX_UPLOAD_BYTES`（預設 10MB）
  - timeout 10s
  - **Stoplight circuit breaker**：連續失敗 5 次開路 60 秒
  - 失敗回 502 + structured log
- [x] `ReceiptsController#upload`：收圖 → sha256 → 呼叫 LIHKG → 回 `{ url, sha256 }`（**唔落 DB**）
- [x] `DeepSeekService`：
  - `call(image_base64:, content_type:, categories:)` → 用 `deepseek-flash` vision
  - `PROMPT_VERSION`（現為 `v2`）：改 prompt／解析邏輯要 bump，令舊 cache 失效
  - Prompt 會帶入當前 user 分類（分 income／expense 列出），要求逐字 copy、唔准翻譯或自創
  - Request body：
    ```json
    {
      "model": "deepseek-flash",
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": "Extract transaction data as JSON..." },
            {
              "type": "image_url",
              "image_url": { "url": "data:image/jpeg;base64,..." }
            }
          ]
        }
      ]
    }
    ```
  - 用 JSON Schema 驗證回傳
  - Log tokens / latency / raw_response 到 AiImportLog（連 `image_urls`）
- [x] `AiController#parse`：
  - 接受 `{ "image_url": "https://..." }`
  - Host 必須喺 `LIHKG_ALLOWED_HOSTS`（預設 `img.eservice-hk.net`），否則 400
  - 先 fetch 圖計 sha256，再用 `image_sha256` + `parse_signature` 查 24 小時 cache
  - 否則：base64 → DeepSeek `deepseek-flash`
  - 回 preview JSON（唔入帳）：`parsed`、`suggested_category_id`、`status`、`raw_response`、`error`、tokens、latency
  - HTTP status：
    - `success` → 200
    - `partial` → 200
    - `failed` → 502
- [x] `AiController#confirm`：
  - 接受 `ai_import_log_id`（或 `import_log_id`）＋ transaction 欄位
  - 用戶確認 → 建 Transaction（`image_urls` = 提供嘅 URL array，冇提供就用 log 嘅，`source = ai`）→ 回填 AiImportLog
  - 支援 `Idempotency-Key`

**Pipeline**

```
upload → LIHKG URL（只回 client，唔寫 Attachment）
       → parse(image_url) whitelist host
       → cache check (24h, sha256 + parse_signature)
       → backend fetch image
       → base64 inline
       → DeepSeek `deepseek-flash` vision
       → JSON Schema validate
       → return preview
       → user confirm → Transaction.image_urls
```

**驗收**

- [x] 上傳 jpg 回 `{ url, sha256 }`，DB **冇** Attachment 表 / row
- [x] 打 LIHKG upload 嘅 HTTP request 帶 `Origin: https://lihkg.com`（WebMock 驗 header）
- [x] 上傳 .exe 回 422
- [x] 同一張圖 24 小時內 parse 兩次，第二次直接回 cache，唔再打 DeepSeek
- [x] DeepSeek 回唔合法 JSON → status = partial，回 raw + error
- [x] confirm 後 `transaction.source = ai` 且 `image_urls` 有嗰條 URL
- [x] LIHKG 連續失敗 5 次後，第 6 次直接回 502（circuit open）
- [x] `/ai/parse` 傳非 whitelist host（例如 `http://127.0.0.1/`）回 400

---

### Phase 6：Dashboard + Summaries

**任務**

- [x] `DashboardController#show`：
  - 總收入 / 總支出 / 淨額（預設當月）
  - 最近 10 筆交易
  - 分類佔比（每行 income_cents + expense_cents，按 expense 再 income 降序）
  - 帳戶餘額（initial + sum(income) - sum(expense)，transfer 不計）
  - 週期交易提醒（7 日內 next_run_at）
- [x] `SummariesController`：
  - `daily`：Asia/Hong_Kong 當日 00:00:00 - 23:59:59
  - `weekly`：Mon 00:00:00 - Sun 23:59:59
  - `monthly`：1 號 00:00:00 - 月末 23:59:59
  - 排除 transfer（獨立 `transfers` key）
  - 回 `daily`（逐日 net_cents）、`by_category`（income_cents + expense_cents）、`by_account`、`transfers`、`transactions` 分頁
  - catch-up 已喺 before_action 跑完，summary 只計真實 Transaction
- [x] 用 `Time.use_zone("Asia/Hong_Kong")` 包住
- [x] 加 index 支援 range query（`(user_id, occurred_at, kind)`）

**計算邏輯**：

```ruby
income_cents  = sum(kind: income)
expense_cents = sum(kind: expense)
net_cents     = income_cents - expense_cents
```

**驗收**

- [x] 9/14（週日）weekly = 9/8 Mon - 9/14 Sun
- [x] 9/15（週一）weekly = 9/15 - 9/21
- [x] monthly 9 月 = 9/1 - 9/30
- [x] transfer 唔計入 income/expense，喺 `transfers` key
- [x] `daily` 逐日 `{ date, net_cents }`（transfer 不計）
- [x] 日界用 Asia/Hong_Kong：`2026-09-14 23:59:59 +08:00` 算 9/14，`2026-09-15 00:00:00 +08:00` 算 9/15

---

### Phase 7：測試 / Docs / 運維

**任務**

- [x] RSpec：model / request / service spec
- [x] FactoryBot factories
- [x] WebMock + VCR mock DeepSeek 同 LIHKG
- [x] `rswag` 產生 OpenAPI，掛 `/api-docs`
- [x] Bullet 開喺 dev/test
- [x] Dashboard／Summaries 聚合 query 固定唔隨 category／account 數量增長（query-count regression specs）
- [x] Brakeman：`config/brakeman.ignore` 記錄 3 個 `:account_id` PermitAttributes false positive（實際由 model-level ownership validation 擋；CI 用 `bin/brakeman -i config/brakeman.ignore`）
- [x] GitHub Actions（`.github/workflows/ci.yml`）：test job 跑 `bin/rails db:test:prepare` + `bundle exec rspec`；`spec/rails_helper.rb` 提供 test 用 `DEEPSEEK_API_KEY`／`JWT_SECRET` 預設，唔依賴 `.env`
- [x] `db/seeds.rb` 目前留空（未使用）；預設帳戶／分類由 `User` 嘅 `after_create` callback 建立
- [x] i18n：錯誤訊息集中喺 `config/locales/zh-TW.yml`
- [x] `Lograge` + JSON log + `request_id`
- [x] `dokku checks:enable` + `/up`
- [x] SQLite backup script（**修正版**）：

```bash
# scripts/backup.sh
dokku run bookkeeping-backend sh -c '
  ts=$(date +%F_%H%M)
  for db in production production_cache; do
    sqlite3 /app/storage/${db}.sqlite3 ".backup /app/storage/backups/${db}_${ts}.sqlite3"
  done
  find /app/storage/backups -name "*.sqlite3" -mtime +7 -delete
'
```

- [x] `lib/tasks/maintenance.rake`：`rails maintenance:cleanup`
  - IdempotencyKey `created_at < 24.hours.ago`
- [x] Host cron 每日跑 backup + maintenance（**唔使 worker**）：

```
0 3 * * * dokku run bookkeeping-backend bin/rails maintenance:cleanup
0 4 * * * /path/to/scripts/backup.sh
```

- [x] `dokku ps:scale bookkeeping-backend web=1`

**驗收**

- [x] `bundle exec rspec` 全綠
- [x] Coverage > 80%
- [x] OpenAPI 喺 `/api-docs` 睇到
- [x] `dokku logs bookkeeping-backend -t` 見到 structured log + request_id
- [x] Backup script 跑完見到 2 個 db backup
- [x] `dokku ps:report bookkeeping-backend` 只有 web process
