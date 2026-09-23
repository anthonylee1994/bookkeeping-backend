# 2. 資料模型

### 2.0 ID 約定

所有 model 用 **UUID v4** 做 primary key，**唔用** integer autoincrement：

- SQLite 冇 native UUID type：欄位用 `varchar(36)` 存 canonical UUID（`8-4-4-4-12` lowercase，例如 `550e8400-e29b-41d4-a716-446655440000`）
- NestJS 用 `crypto.randomUUID()` 生成 id（`src/common/util.ts` 的 `newId()`）；TypeORM entity 有 `@PrimaryColumn` 但唔靠 DB default
- TypeORM entity 用 snake_case 欄位名，同 DB column 1:1（唔用 naming strategy 轉名）
- 所有 FK 一律 `varchar(36)`，constraint 用 `ON DELETE CASCADE / SET NULL / RESTRICT`（見 `src/database/migrations/20260921000000-init.ts`）
- API JSON 同 path param 嘅 `id` / `*_id` 全部係 UUID string
- JWT payload `user_id` 都係 UUID string
- **排序**：UUID v4 唔按插入順序，列表一律明確 `orderBy` `created_at`（或指定欄位），唔可以靠 `id`
- **日期／時間**：entity 型別一律 `string`；DB 欄位宣告 `varchar`（TEXT affinity）。canonical 值：datetime `YYYY-MM-DD HH:MM:SS.SSS`、date `YYYY-MM-DD`（HK local wall time，唔轉 UTC）。字串排序等同時間排序，range filter / order by 直接用字串比較

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
- unique index `(user_id, kind, name)`
- **冇** `position` 欄位；列表固定按 `(:kind, :created_at)` 排序
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

**更新**：可改 `name`、`default_category_id`（`default_category` 必須屬於同一 user，否則 422）。

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
- `source` enum：`manual / recurring / ai / import`（DB 存 integer，default 0 = manual）
- `transfer_account_id` uuid FK（kind=transfer 時用，`on_delete: :restrict`）
- `idempotency_key` string, nullable（配合 IdempotencyKey table 使用）
- timestamps
- Index `(user_id, occurred_at)`, `(user_id, kind, occurred_at)`, `(user_id, occurred_at, kind)`
- **冇** `refund_of_id`（2026-09-15 移除退款功能）

**驗證**：

- income/expense：`transfer_account_id` 必須 nil
- transfer：`category_id` 必須 nil，`transfer_account_id` 必須存在且 != account_id
- `amount_cents > 0`
- `image_urls` 必須係 string array（可空）
- `account` / `category` / `merchant` / `transfer_account` 必須屬於同一 user（model-level ownership validation）

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
- `image_urls` json, default: `[]`, null: false
- `image_sha256` string, null: false, index
- `parse_signature` string, nullable（= `Digest::SHA256.hexdigest(PROMPT_VERSION + user 分類名單)`；改名／加減分類或 bump prompt 都會令 cache 失效）
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
- Index `(user_id, image_sha256, created_at)` 同 `(user_id, image_sha256, parse_signature)`（cache lookup）

**去重**：用 `image_sha256` + `parse_signature` 查最近一筆，若 24 小時（`AI_CACHE_HOURS`）內 `status = success` 就回傳 cache；cache hit 時仍會用當前 user 分類重新 normalize `category_hint`。

### 2.9 IdempotencyKey（獨立表）

- `id` uuid PK
- `user_id` uuid FK, null: false
- `key` string, null: false
- `request_hash` string, null: false（SHA256 of method + path + body）
- `response_status` integer
- `response_body` text
- `created_at` datetime
- unique index `(user_id, key)`
- index `created_at`（for daily maintenance）

**用途**：`POST /transactions`、`POST /ai/confirm` 支援 `Idempotency-Key` header。同 key 且 24 小時內 → replay 當時 response；同 key 但 `request_hash` 唔同 → 422 `idempotency_conflict`。Host cron 每日清 > 24 小時（見 Phase 7 maintenance）。
