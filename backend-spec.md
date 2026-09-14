# 記帳 App Rails API Backend Spec

---

## 0. 概覽與假設

### 0.1 目標

建立 Rails 8 API-only 記帳後端，支援多用戶、收入/支出/轉帳、分類、帳戶、商家、週期性交易、單次交易、圖片帳單 AI 記帳、Dashboard 與 daily/weekly/monthly summary。部署到 Dokku。

### 0.2 假設（請確認）

- 單一貨幣 HKD（DB 保留 currency 欄位，預設 HKD）
- 每個 user 註冊時自動建立一個「現金」Account
- 時區固定 `Asia/Hong_Kong`（Rails `config.time_zone`、`ActiveRecord::Base.default_timezone = :local`、user 預設、OS `TZ` 一律呢個；DB 讀寫唔轉 UTC）
- Weekly = Monday 00:00:00 至 Sunday 23:59:59（Asia/Hong_Kong）
- Monthly = 1 號 00:00:00 至月末 23:59:59（Asia/Hong_Kong）
- Recurring 用 **request-time catch-up**，唔用 background job / worker
- Recurring backfill **預設關閉**；可選開啟，上限 90 日
- 刪除一律 **hard delete**（唔用 soft delete / `discarded_at`）
- JWT **所有 env 都唔 check exp**；token 唔寫 `exp`；**冇 UserSession**；logout 只係 frontend 刪 JWT
- Auth **只用 username + password**，唔用 email
- LIHKG 上傳 API 係**非官方**圖床（eservice-hk），唔保證穩定；出站 upload **必須**帶 `Origin: https://lihkg.com`（圖床會 check，缺或唔係呢個值會拒）
- DeepSeek `deepseek-flash` **原生支援 vision**，無需 OCR fallback
- Dokku 用 Dockerfile buildpack（Rails 8 預設）
- Dokku 上 SQLite 檔案用 persistent storage mount
- 所有 model PK / FK 用 **UUID**（SQLite 存 `varchar(36)`，API 一律 UUID string）

### 0.3 Dokku 部署總覽

- App name：`bookkeeping-backend`
- Domain：`book-api.on99.app`（用現成 cert：`dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar`）
- Storage mount：`/var/lib/dokku/data/storage/bookkeeping-backend/storage:/app/storage`
- SQLite DB：primary / cache 全部放 `/app/storage`（唔開 queue / cable）
- Procfile：web + release（**冇 worker**）
- ENV 用 `dokku config:set` 管理，唔 commit secret
- Host cron 每日跑 backup + maintenance，rotate 7 日

---

## 1. 技術棧

| 項目            | 選擇                                                             |
| --------------- | ---------------------------------------------------------------- |
| Ruby            | 3.3.x                                                            |
| Rails           | 8.x API-only                                                     |
| DB              | SQLite 3（WAL mode, busy_timeout=5000）                          |
| Auth            | bcrypt + JWT（`jwt` gem）                                        |
| Background      | **冇**。Recurring 用 request-time catch-up；cleanup 用 host cron |
| Cache           | Solid Cache                                                      |
| WebSocket       | 唔用（Solid Cable 唔裝）                                         |
| Rate limit      | Rack::Attack                                                     |
| 分頁            | Pagy（max_per_page=100）                                         |
| 測試            | RSpec + FactoryBot + WebMock + VCR                               |
| API Docs        | rswag                                                            |
| N+1 檢測        | Bullet（dev/test）                                               |
| 刪除            | hard delete（唔用 discard）                                      |
| HTTP Client     | Faraday + faraday-retry                                          |
| Circuit Breaker | stoplight                                                        |
| ENV             | dotenv（dev）+ Dokku config（prod）                              |
| 部署            | Dokku（Dockerfile）                                              |

---

## 2. 資料模型

### 2.0 ID 約定

所有 model 用 **UUID v4** 做 primary key，**唔用** integer autoincrement：

- SQLite 冇 native UUID type：欄位用 `varchar(36)` 存 canonical UUID（`8-4-4-4-12` lowercase，例如 `550e8400-e29b-41d4-a716-446655440000`）
- `config/initializers/sqlite_uuid.rb` 將 `:uuid` map 做 `varchar(36)`，令 `create_table ..., id: :uuid` 同 `t.references ..., type: :uuid` 行得通
- `config.generators`：`g.orm :active_record, primary_key_type: :uuid`
- `ApplicationRecord`：
  - `before_create`：`self.id ||= SecureRandom.uuid`（SQLite 冇 `gen_random_uuid()`）
  - `self.implicit_order_column = "created_at"`（UUID v4 唔按插入順序，`Model.first` / `.last` 唔可以靠 `id`）
- 所有 FK（`t.references` / `t.belongs_to`）一律 `type: :uuid`
- API JSON 同 path param 嘅 `id` / `*_id` 全部係 UUID string
- JWT payload `user_id` 都係 UUID string
- `schema.rb` dump 可能寫 `id: :string, limit: 36`（SQLite 冇 uuid SQL type）；migration 一律寫 `id: :uuid`

### 2.1 User

- `id` uuid PK
- `username` string, null: false, unique index（case-insensitive）；存 lowercase
- `password_digest` string, null: false
- **冇** `email` 欄位
- `timezone` string, default: "Asia/Hong_Kong"
- `currency` string, default: "HKD"
- timestamps

### 2.2 Account

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `name` string, null: false
- `kind` enum：`cash / bank / credit_card / e_wallet / other`
- `icon` string, nullable
- `color` string, nullable
- `initial_balance_cents` integer, default: 0
- `currency` string, default: "HKD"
- unique index `(user_id, name)`
- timestamps

**刪除**：若該帳戶有任何 transaction（含 `transfer_account_id`）或 RecurringRule → 422 `account_in_use`；否則 hard delete。

### 2.3 Category

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `name` string, null: false
- `kind` enum：`income / expense`
- `icon` string, nullable
- `color` string, nullable
- `position` integer, default: 0
- unique index `(user_id, kind, name)`
- timestamps

**刪除**：hard delete；所屬交易 `category_id` SET NULL（`on_delete: :nullify`）。

### 2.4 Merchant

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `name` string, null: false
- `default_category_id` uuid FK, nullable, `on_delete: :nullify`
- `usage_count` integer, default: 0
- unique index `(user_id, name)`
- timestamps

**刪除**：hard delete；所屬交易 `merchant_id` SET NULL（`on_delete: :nullify`）。

### 2.5 Transaction

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `account_id` uuid FK, null: false, index（`on_delete: :restrict`）
- `category_id` uuid FK, nullable, index（`on_delete: :nullify`）
- `merchant_id` uuid FK, nullable, index（`on_delete: :nullify`）
- `kind` enum：`income / expense / transfer`
- `amount_cents` integer, null: false（永遠正數）
- `currency` string, default: "HKD"
- `occurred_at` datetime, null: false, index
- `note` text
- `payment_method` string, nullable
- `image_urls` json, default: `[]`（字串 array，記 LIHKG 等圖床 URL）
- `source` enum：`manual / recurring / ai / import`
- `refund_of_id` uuid FK self, nullable（`on_delete: :cascade`：刪原交易一齊刪退款）
- `transfer_account_id` uuid FK（kind=transfer 時用，`on_delete: :restrict`）
- `idempotency_key` string, nullable（配合 IdempotencyKey table 使用）
- timestamps
- Index `(user_id, occurred_at)`, `(user_id, kind, occurred_at)`

**驗證**：

- income/expense：`transfer_account_id` 必須 nil
- transfer：`category_id` 必須 nil，`transfer_account_id` 必須存在且 != account_id
- `amount_cents > 0`
- `image_urls` 必須係 string array（可空）

### 2.6 RecurringRule

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `account_id` uuid FK, null: false（`on_delete: :restrict`）
- `category_id` uuid FK, nullable（`on_delete: :nullify`）
- `merchant_id` uuid FK, nullable（`on_delete: :nullify`）
- `kind` enum：`income / expense`
- `amount_cents` integer, null: false
- `currency` string, default: "HKD"
- `frequency` enum：`daily / weekly / monthly / yearly`
- `interval` integer, default: 1
- `day_of_week` integer, nullable（0-6, weekly 用）
- `day_of_month` integer, nullable（1-31, monthly 用）
- `month_of_year` integer, nullable（1-12, yearly 用）
- `start_on` date, null: false
- `end_on` date, nullable
- `next_run_at` datetime, null: false, index
- `last_run_at` datetime, nullable
- `status` enum：`active / paused / ended`, default: `active`
- `note` text
- timestamps

**刪除**：hard delete；已產生嘅 transaction 保留；`RecurringOccurrence` cascade delete。

**Edge case**：

- `day_of_month = 31` 但當月冇 31 號 → 取當月最後一日
- `interval > 1` 時，由 `start_on` 起計

### 2.7 RecurringOccurrence（idempotency）

- `id` uuid PK
- `recurring_rule_id` uuid FK, null: false（`on_delete: :cascade`）
- `occurred_on` date, null: false
- `transaction_id` uuid FK, nullable（`on_delete: :nullify`）
- unique index `(recurring_rule_id, occurred_on)`
- timestamps

> 刪咗由 recurring 產生嘅 transaction 之後，occurrence 保留、`transaction_id = nil`，catch-up **唔會**再為該日產生交易。

### 2.8 AiImportLog

- `id` uuid PK
- `user_id` uuid FK, null: false, index
- `image_urls` json, default: `[]`
- `image_sha256` string, index
- `provider` string, default: "deepseek"
- `model` string, default: "deepseek-flash"
- `tokens_in` integer
- `tokens_out` integer
- `latency_ms` integer
- `status` enum：`pending / success / failed / partial`
- `raw_response` text
- `parsed_json` json
- `error_message` text
- `transaction_id` uuid FK, nullable（`on_delete: :nullify`）
- `idempotency_key` string, nullable
- timestamps

**去重**：`(user_id, image_sha256)` 查最近一筆，若 24 小時內 `status = success` 就回傳 cache。

### 2.9 IdempotencyKey（獨立表）

- `id` uuid PK
- `user_id` uuid FK, null: false
- `key` string, null: false
- `request_hash` string（SHA256 of method + path + body）
- `response_status` integer
- `response_body` text
- `created_at` datetime
- unique index `(user_id, key)`
- index `created_at`（for daily maintenance）

**用途**：`POST /transactions`、`POST /ai/confirm` 等支援 `Idempotency-Key` header。Host cron 每日清 > 24 小時（見 Phase 7 maintenance）。

---

## 3. API Endpoints（`/api/v1`）

### 3.1 Auth

| Method | Path             | 說明                      |
| ------ | ---------------- | ------------------------- |
| POST   | `/auth/register` | username + password       |
| POST   | `/auth/login`    | username + password → JWT |
| GET    | `/me`            | 當前 user                 |

> **Logout**：backend **冇** `/auth/logout`、**冇** `/sessions`。Frontend 刪本地 JWT 就算登出。舊 token 仍然有效，直至 rotate `JWT_SECRET`。

### 3.2 Accounts

| Method | Path            | 說明                                                         |
| ------ | --------------- | ------------------------------------------------------------ |
| GET    | `/accounts`     | list                                                         |
| POST   | `/accounts`     | create                                                       |
| PATCH  | `/accounts/:id` | update                                                       |
| DELETE | `/accounts/:id` | hard delete（有交易 / RecurringRule → 422 `account_in_use`） |

### 3.3 Categories

| Method | Path                       | 說明                                       |
| ------ | -------------------------- | ------------------------------------------ |
| GET    | `/categories?kind=expense` | list                                       |
| POST   | `/categories`              | create                                     |
| PATCH  | `/categories/:id`          | update                                     |
| DELETE | `/categories/:id`          | hard delete（交易 `category_id` SET NULL） |

### 3.4 Merchants

| Method | Path                     | 說明                                       |
| ------ | ------------------------ | ------------------------------------------ |
| GET    | `/merchants?q=starbucks` | autocomplete                               |
| POST   | `/merchants`             | create                                     |
| DELETE | `/merchants/:id`         | hard delete（交易 `merchant_id` SET NULL） |

### 3.5 Transactions

| Method | Path                          | 說明                                                                                                                                                 |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/transactions`               | filter: `from, to, kind, category_id, account_id, merchant_id, q, min_amount, max_amount`；sort: `occurred_at, amount_cents, created_at`；pagination |
| POST   | `/transactions`               | create（支援 `Idempotency-Key`、可選 `image_urls`）                                                                                                  |
| GET    | `/transactions/:id`           | show                                                                                                                                                 |
| PATCH  | `/transactions/:id`           | update                                                                                                                                               |
| DELETE | `/transactions/:id`           | hard delete                                                                                                                                          |
| POST   | `/transactions/:id/refund`    | 建立關聯退款（全額或部分）                                                                                                                           |
| POST   | `/transactions/:id/duplicate` | 複製一筆                                                                                                                                             |

**Refund request**：

```json
POST /api/v1/transactions/550e8400-e29b-41d4-a716-446655440000/refund
{
  "amount_cents": 5000,        // 可選，預設全額
  "occurred_at": "2026-09-14T10:00:00+08:00",
  "note": "商家退款"
}
```

**Refund response**：回傳新建立嘅 refund transaction（`refund_of_id = "550e8400-e29b-41d4-a716-446655440000"`），同時回傳原交易嘅 `net_amount_cents`。

### 3.6 Recurring Rules

| Method | Path                             | 說明                          |
| ------ | -------------------------------- | ----------------------------- |
| GET    | `/recurring_rules`               | list                          |
| POST   | `/recurring_rules`               | create                        |
| PATCH  | `/recurring_rules/:id`           | update                        |
| DELETE | `/recurring_rules/:id`           | hard delete（已產生交易保留） |
| POST   | `/recurring_rules/:id/pause`     | 暫停                          |
| POST   | `/recurring_rules/:id/resume`    | 恢復                          |
| POST   | `/recurring_rules/:id/run_now`   | 手動觸發一次                  |
| POST   | `/recurring_rules/:id/skip_next` | 跳過下一次                    |

### 3.7 Receipts / AI

| Method | Path               | 說明                                                               |
| ------ | ------------------ | ------------------------------------------------------------------ |
| POST   | `/receipts/upload` | 上傳圖片 → LIHKG → 回 `{ url, sha256 }`（**唔**寫 Attachment）     |
| POST   | `/ai/parse`        | 傳 `image_url` → DeepSeek `deepseek-flash` → preview               |
| POST   | `/ai/confirm`      | 用戶確認 → 建立 transaction（寫入 `image_urls`），關聯 AiImportLog |

> **注意**：`/ai/parse` 只接受 whitelist host 嘅 URL（預設 `img.eservice-hk.net`），防 SSRF。唔用 Attachment model。

### 3.8 Dashboard

| Method | Path         | 說明                                               |
| ------ | ------------ | -------------------------------------------------- |
| GET    | `/dashboard` | 總收入、總支出、淨額、最近交易、分類佔比、帳戶餘額 |

### 3.9 Summaries

| Method | Path                                 | 說明              |
| ------ | ------------------------------------ | ----------------- |
| GET    | `/summaries/daily?date=2026-09-14`   | 單日              |
| GET    | `/summaries/weekly?date=2026-09-14`  | 該週（Mon-Sun）   |
| GET    | `/summaries/monthly?date=2026-09-14` | 該月（1 號-月末） |

**回應格式**：

```json
{
  "data": {
    "range": { "from": "...", "to": "..." },
    "income_cents": 100000,
    "expense_cents": 50000,
    "refund_cents": 5000,
    "net_cents": 55000,
    "by_category": [
      { "category_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "name": "飲食", "expense_cents": 30000, "refund_cents": 1000 }
    ],
    "by_account": [...],
    "transfers": { "count": 3, "total_cents": 200000 },
    "transactions": { "data": [...], "meta": {...} }
  }
}
```

### 3.10 Health

| Method | Path               | 說明                  |
| ------ | ------------------ | --------------------- |
| GET    | `/up`              | Rails 8 內建 liveness |
| GET    | `/health`          | 整體                  |
| GET    | `/health/db`       | DB 連線 + WAL         |
| GET    | `/health/deepseek` | DeepSeek ping         |
| GET    | `/health/lihkg`    | LIHKG 圖床 ping       |

---

## 4. 業務規則

1. **金額**：integer cents，永遠正數；方向由 `kind` 決定
2. **時區**：全 app `Asia/Hong_Kong`。`config.time_zone = "Asia/Hong_Kong"`；`ActiveRecord::Base.default_timezone = :local`（Rails 只接受 `:utc` / `:local`，靠 OS `TZ=Asia/Hong_Kong` 令 local = Hong Kong）。DB 讀寫 **唔轉 UTC**。顯示同計算（summary、recurring catch-up、日/週/月邊界）一律用 `Time.zone`（Hong Kong）
3. **Weekly**：Asia/Hong_Kong Mon 00:00:00 至 Sun 23:59:59.999999
4. **Monthly**：Asia/Hong_Kong 1 號 00:00:00 至月末 23:59:59.999999
5. **Transfer**：唔計入 income/expense summary；獨立 `transfers` key
6. **Recurring 產生邏輯**（request-time catch-up，**唔用 background job**）：

- 已 authenticate 嘅 request 開頭呼叫 `RecurringCatchUp.call(user: current_user)`（`Time.use_zone("Asia/Hong_Kong")`）
- 跳過：Auth、Health
- 只處理該 user `status = active` 且 `next_run_at <= now` 嘅 rule
- 用 `RecurringOccurrence` unique index 保證 idempotent；併發 request 撞 unique → rescue 當已處理
- 產生後 `last_run_at = now`，`next_run_at = 下次`
- 若 `end_on` 已過 → status = ended
- **Backfill 規則**：
  - `RECURRING_BACKFILL_ENABLED=false`（預設）：user 幾耐冇開 app 都只產生「今日」一筆，中間 occurrence 寫 RecurringOccurrence 但 `transaction_id = nil`
  - `RECURRING_BACKFILL_ENABLED=true`：補最多 `RECURRING_BACKFILL_MAX_DAYS`（預設 90）日，超過就 skip 並 log
  - 無論開唔開，每個 due occurrence 都會寫 RecurringOccurrence，避免重複
- 刪咗由 recurring 產生嘅 transaction：occurrence 保留、`transaction_id = nil`，**唔會**再為該日自動產生
- `run_now`：若該 `occurred_on` 未有 transaction，補建並關聯；已有 → 409 `already_materialized`
- `skip_next`：為下一次寫 RecurringOccurrence（`transaction_id = nil`），推進 `next_run_at`

1. **刪除分類**：hard delete；交易保留，`category_id` SET NULL
2. **刪除帳戶**：若有任何交易（含作 transfer 目標）或 RecurringRule → 422 `account_in_use`；否則 hard delete
3. **刪除交易**：hard delete。指向佢嘅 refund 一齊刪（`dependent: :destroy`）。若 `source = recurring`，對應 RecurringOccurrence.transaction_id SET NULL，唔再生該 occurrence
4. **刪除商家**：hard delete；交易 `merchant_id` SET NULL
5. **刪除 RecurringRule**：hard delete；已產生 transaction 保留；occurrences cascade delete
6. **AI 解析流程**：

- 上傳 → LIHKG → 回 URL + sha256（唔落 DB）
  - parse：whitelist host → sha256 查 AiImportLog 24 小時內成功記錄 → 有就回 cache
  - 冇就：backend fetch 圖 → base64 inline → DeepSeek `deepseek-flash` vision
  - 回傳 preview JSON（唔直接入帳）
  - 用戶 confirm → 建立 transaction（`image_urls` + `source = ai`）+ AiImportLog.transaction_id

1. **AI JSON schema**（用 JSON Schema 驗證）：

```json
{
  "type": "object",
  "required": ["amount_cents", "kind", "occurred_at"],
  "properties": {
    "amount_cents": { "type": "integer", "minimum": 1 },
    "kind": { "enum": ["income", "expense"] },
    "occurred_at": { "type": "string", "format": "date-time" },
    "merchant_name": { "type": ["string", "null"] },
    "category_hint": { "type": ["string", "null"] },
    "note": { "type": ["string", "null"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

1. **Idempotency-Key**：`POST /transactions` 同 `/ai/confirm` 支援，獨立 `IdempotencyKey` table，24 小時過期，host cron 每日清
2. **重複交易偵測**：建立前 check 同日同商戶同金額，回 warning 但唔 block
3. **退款**：

- `refund_of_id` 指向原交易
  - `kind` 同原交易相同（expense 退 expense）
  - `amount_cents` 正數
  - Summary 用 `refund_cents` 欄位獨立統計，計算：
    - `net_expense = expense_cents - refund_cents`
    - `net_cents = income_cents - net_expense`
  - `by_category` 各自顯示 `expense_cents` 同 `refund_cents`

1. **SSRF 防護**：`/ai/parse` 只收 whitelist host 嘅 `image_url`（`ENV["LIHKG_ALLOWED_HOSTS"]`，預設 `img.eservice-hk.net`）；backend 自己 fetch。非 whitelist → 400
2. **LIHKG 圖床風險**：用 stoplight circuit breaker，連續失敗 5 次開路 60 秒；失敗時回 502，log 詳細。出站 upload Faraday request **必須**帶 `Origin: https://lihkg.com`（硬編碼，圖床會 check Origin）
3. **Pagy 上限**：`Pagy::DEFAULT[:max_per_page] = 100`

---

## 5. Phases

### Phase 0：專案初始化 + Dokku 準備

**目標**：Rails 8 API-only 骨架、Dokku app、SQLite persistent storage。

**任務**

- [ ] `rails new bookkeeping_api --api --database=sqlite3 --skip-test --skip-action-mailer --skip-action-mailbox --skip-action-text --skip-active-storage`
- [ ] 加 gem：`bcrypt`, `jwt`, `rack-cors`, `rack-attack`, `pagy`, `rswag`, `dotenv-rails`(dev), `bullet`(dev/test), `rspec-rails`, `factory_bot_rails`, `webmock`, `vcr`, `faraday`, `faraday-retry`, `stoplight`, `lograge`
- [ ] **唔裝**：`discard`、Solid Queue、Solid Cable
- [ ] `config/application.rb`：
  - `config.time_zone = "Asia/Hong_Kong"`
  - `config.active_record.default_timezone = :local`
  - `config.middleware.insert_after ActionDispatch::RequestId, ActionDispatch::RequestId`
- [ ] `config/initializers/cors.rb`：origin 由 `ENV["CORS_ORIGINS"].split(",")` 讀
- [ ] `config/initializers/rack_attack.rb`：login 5/min/IP、AI 10/min/user、upload 20/min/user
- [ ] `config/initializers/pagy.rb`：`Pagy::DEFAULT[:max_per_page] = 100`
- [ ] `config/initializers/sqlite_uuid.rb`：將 `:uuid` map 做 `varchar(36)`（SQLite 冇 native UUID）
- [ ] `config.generators`：`g.orm :active_record, primary_key_type: :uuid`
- [ ] `ApplicationRecord`：
  - `before_create`：`self.id ||= SecureRandom.uuid`
  - `self.implicit_order_column = "created_at"`
- [ ] `config/database.yml`：2 個 DB（primary / cache）全部指向 `storage/`
- [ ] SQLite WAL：`config/initializers/sqlite_pragma.rb`

```ruby
Rails.application.config.after_initialize do
  ActiveRecord::Base.connection_pool.with_connection do |conn|
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
  end
end
```

- [ ] Solid Cache 安裝（唔裝 Queue / Cable）：

```bash
bin/rails solid_cache:install
```

- [ ] `Dockerfile`（Rails 8 預設，`EXPOSE 3000`）
- [ ] `Procfile`：

```
web: bundle exec puma -C config/puma.rb
release: bundle exec rails db:prepare && bundle exec rails db:migrate
```

- [ ] `docs/dokku-setup.md`（純文檔，placeholder）
- [ ] `.gitignore` 加 `bin/dokku-setup.sh`、`docs/dokku-setup.local.md`
- [ ] `bin/dokku-setup.sh.example`（範本）

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
- [x] User 註冊後 callback 建立：
  - 「現金」Account（kind=cash）
  - 預設分類：
    - Expense：飲食、交通、娛樂、購物、醫療、住屋、水電、其他支出
    - Income：薪水、獎金、投資、兼職、其他收入
- [x] Account / Category / Merchant controller CRUD + hard delete
  - Category / Merchant：delete 時 FK nullify
  - Account：有交易或 RecurringRule → 422 `account_in_use`
- [x] Merchant autocomplete：`GET /merchants?q=`，回 top 10，SQLite `LIKE`
- [x] 所有 query scope 到 `current_user`

**驗收**

- [x] 新 user 登入後 `GET /accounts` 見到「現金」
- [x] 刪分類後 `GET /categories` 唔見，但舊交易仍顯示 category_id = null
- [x] 帳戶有交易時 DELETE 回 422 `account_in_use`
- [x] 打其他人 category id 回 404
- [x] 預設分類冇一個叫「收入」（避免同 kind=income 混淆）

---

### Phase 3：Transaction CRUD + Idempotency + Refund

**任務**

- [x] Migration：Transaction（2.5）、IdempotencyKey（2.9）：全部 `id: :uuid`；FK 一律 `type: :uuid`
- [x] `Transaction` model：enum kind、validation、scope、`by_user`
- [x] `TransactionsController`：index（filter + sort + pagy）、create、show、update、destroy（hard delete；關聯 refund `dependent: :destroy`）
- [x] Idempotency middleware / concern：
  - 讀 `Idempotency-Key` header
  - 查 IdempotencyKey table
  - 若存在且 `created_at > 24.hours.ago` → 回 cache response
  - 否則執行 request，寫入 IdempotencyKey
  - 過期 key 由 host cron `rails maintenance:cleanup` 每日清 > 24 小時
- [x] 建立時：update `merchant.usage_count`、自動 dedupe warning
- [x] `POST /transactions/:id/refund`：
  - 接受可選 `amount_cents`（預設全額）
  - 建立新 transaction，`refund_of_id = 原 id`
  - `kind` 同原交易
  - `source = manual`
- [x] `POST /transactions/:id/duplicate`：複製欄位，`occurred_at = now`

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
- [x] Refund 後原交易 `net_amount_cents` 正確
- [x] 刪原交易後，關聯 refund 一齊消失
- [x] 刪交易後 `GET /transactions` 真係冇嗰筆（hard delete）
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
  - `parse(image_base64:)` → 用 `deepseek-flash` vision
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
  - 先 fetch 圖計 sha256，查 `(user_id, image_sha256)` 24 小時 cache
  - 否則：base64 → DeepSeek `deepseek-flash`
  - 回 preview JSON（唔入帳）
  - HTTP status：
    - `success` → 200
    - `partial` → 200（confidence 低）
    - `failed` → 502
- [x] `AiController#confirm`：
  - 用戶確認 → 建 Transaction（`image_urls` = 確認嘅 URL array，`source = ai`）→ 關聯 AiImportLog
  - 支援 `Idempotency-Key`

**Pipeline**

```
upload → LIHKG URL（只回 client，唔寫 Attachment）
       → parse(image_url) whitelist host
       → cache check (24h, sha256)
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
  - 總收入 / 總支出 / 退款 / 淨額（預設當月）
  - 最近 10 筆交易
  - 分類佔比（top 5，含 refund）
  - 帳戶餘額（initial + sum(income) - sum(expense) + sum(refund)）
  - 週期交易提醒（7 日內 next_run_at）
- [x] `SummariesController`：
  - `daily`：Asia/Hong_Kong 當日 00:00:00 - 23:59:59
  - `weekly`：Mon 00:00:00 - Sun 23:59:59
  - `monthly`：1 號 00:00:00 - 月末 23:59:59
  - 排除 transfer（獨立 `transfers` key）
  - 回 by_category（含 refund_cents）、by_account、transfers、transactions 分頁
  - catch-up 已喺 before_action 跑完，summary 只計真實 Transaction
- [x] 用 `Time.use_zone("Asia/Hong_Kong")` 包住
- [x] 加 index 支援 range query

**計算邏輯**：

```ruby
income_cents   = sum(kind: income)
expense_cents  = sum(kind: expense, refund_of_id: nil)
refund_cents   = sum(kind: expense).where.not(refund_of_id: nil)
net_expense    = expense_cents - refund_cents
net_cents      = income_cents - net_expense
```

**驗收**

- [x] 9/14（週日）weekly = 9/8 Mon - 9/14 Sun
- [x] 9/15（週一）weekly = 9/15 - 9/21
- [x] monthly 9 月 = 9/1 - 9/30
- [x] transfer 唔計入 income/expense，喺 `transfers` key
- [x] 退款正確扣減 net_expense
- [x] 日界用 Asia/Hong_Kong：`2026-09-14 23:59:59 +08:00` 算 9/14，`2026-09-15 00:00:00 +08:00` 算 9/15

---

### Phase 7：測試 / Docs / 運維

**任務**

- [x] RSpec：model / request / service spec
- [x] FactoryBot factories
- [x] WebMock + VCR mock DeepSeek 同 LIHKG
- [x] `rswag` 產生 OpenAPI，掛 `/api-docs`
- [x] Bullet 開喺 dev/test
- [x] Seed：admin user、預設分類、範例交易
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
- [ ] `dokku logs bookkeeping-backend -t` 見到 structured log + request_id
- [ ] Backup script 跑完見到 2 個 db backup
- [ ] `dokku ps:report bookkeeping-backend` 只有 web process

---

## 6. 環境變數範例

```bash
# Rails
RAILS_ENV=production
RAILS_MASTER_KEY=...
SECRET_KEY_BASE=...
RAILS_LOG_TO_STDOUT=true

# DB（全部喺 /app/storage）
DATABASE_URL=sqlite3:///app/storage/production.sqlite3
CACHE_DATABASE_URL=sqlite3:///app/storage/production_cache.sqlite3

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

# 業務
TZ=Asia/Hong_Kong
RECURRING_BACKFILL_ENABLED=false
RECURRING_BACKFILL_MAX_DAYS=90
AI_CACHE_HOURS=24
```

---

## 7. 統一錯誤格式

```json
{
  "error": {
    "code": "validation_error",
    "message": "Amount can't be blank",
    "details": { "amount_cents": ["can't be blank"] },
    "request_id": "abc-123"
  }
}
```

常見 code：`unauthorized`, `forbidden`, `not_found`, `validation_error`, `rate_limited`, `upstream_error`, `idempotency_conflict`, `circuit_open`, `account_in_use`, `already_materialized`

`request_id` 由 `ActionDispatch::RequestId` middleware 產生，喺 `ApplicationController` rescue_from 時帶入。

---

## 8. 分頁格式

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

Pagy 預設回 `page, items, count, pages`，要自己 map 做上面格式。

---

## 9. Dokku 部署 Checklist

- [ ] `Dockerfile` 用 Rails 8 預設，`EXPOSE 3000`
- [ ] `Procfile` 有 `release` task 跑 migration
- [ ] `dokku storage:mount` 將 `/app/storage` 掛出去
- [ ] `dokku config:set` 所有 ENV
- [ ] `dokku domains:set bookkeeping-backend book-api.on99.app`
- [ ] `dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar`
- [ ] `dokku checks:enable` + `web.wait-to-retire 30` + `web.initial-delay 10`
- [ ] `dokku ps:scale bookkeeping-backend web=1`（**冇 worker**）
- [ ] Host cron 每日跑 backup + `rails maintenance:cleanup`
- [ ] `dokku logs` 確認冇 error
- [ ] `dokku enter bookkeeping-backend web ls -la /app/storage` 見到 primary + cache sqlite 檔
- [ ] `dokku enter bookkeeping-backend web ls -la /app/storage/backups` 見到 backup

---

## 10. 未確定事項 / 風險

1. **DeepSeek vision 已 GA**：`deepseek-flash` 原生支援 image input，三種傳入方式（base64 / URL / file_id）。單張圖最多 384 tokens，定價同文字模型相同。舊名 `deepseek-v4-flash-vision-exp` 仍兼容但已路由到 `deepseek-flash`。
2. **LIHKG API 非官方**：`img.eservice-hk.net` 唔係 LIHKG 官方 API，冇 SLA、冇文檔、可能隨時改。出站 upload **必須** `Origin: https://lihkg.com`，否則圖床會拒。已加 stoplight circuit breaker，但要有 fallback 圖床（S3 / R2）嘅 plan。
3. **SQLite 併發**：而家得 web process 寫，風險細過 web+worker；WAL + busy_timeout 仍然要。Catch-up 喺 read request 寫入，單 user 可接受；高負載要轉 Postgres。
4. **JWT 永久有效**：唔寫、唔驗證 `exp`；冇 UserSession，server **唔能** revoke 單張 token。Logout = frontend 刪本地 JWT。遺失 token 要 rotate `JWT_SECRET` 先全部作廢。
5. **Dokku storage 單點**：冇 replication，靠 backup。
6. **多貨幣**：而家只 HKD，將來加外幣要 exchange rate service。
7. **Transfer 報表**：spec 只定義 summary 有 `transfers` key，詳細報表將來再補。
8. **退款邏輯**：已定義 Option C（`refund_cents` 獨立統計），但 by_category 顯示方式要同 product 確認。
9. **Recurring catch-up**：user 唔打 API 就唔會產生交易。呢個係故意。Backfill 預設關閉；若開啟，90 日上限係假設，要同 product 確認。
10. **Hard delete 唔可還原**：刪交易會一齊刪關聯 refund；刪分類 / 商家只 nullify FK。帳戶有交易就刪唔到。
11. **圖片 URL 持久性**：LIHKG URL 可能過期，將來要考慮 re-host 到 S3 / R2。
12. **DeepSeek rate limit / cost**：未設 budget alert，將來要加。
13. **AI JSON schema 嚴格度**：太嚴會令 partial 增加，太鬆會入錯數，要 collect 真實數據再 tune。

---

## 附錄 A：DeepSeek Vision Request 範例

```ruby
# app/services/deep_seek_service.rb
class DeepSeekService
  def parse(image_base64:, content_type:)
    body = {
      model: ENV.fetch("DEEPSEEK_MODEL", "deepseek-flash"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: <<~PROMPT
                Extract transaction data from this receipt image.
                Return ONLY valid JSON matching this schema:
                {
                  "amount_cents": integer,
                  "kind": "income" | "expense",
                  "occurred_at": ISO8601 string,
                  "merchant_name": string | null,
                  "category_hint": string | null,
                  "note": string | null,
                  "confidence": number (0-1)
                }
              PROMPT
            },
            {
              type: "image_url",
              image_url: { url: "data:#{content_type};base64,#{image_base64}" }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    }

    response = connection.post("/chat/completions", body.to_json)
    # parse, validate schema, log tokens/latency
  end
end
```
