# 3. API Endpoints（`/api/v1`）

### 3.1 Auth

| Method | Path             | 說明                      |
| ------ | ---------------- | ------------------------- |
| POST   | `/auth/register` | username + password       |
| POST   | `/auth/login`    | username + password → JWT |
| GET    | `/me`            | 當前 user                 |
| PATCH  | `/me/password`   | 更改密碼                  |

> **更改密碼**：`PATCH /me/password`，body 為 `password_challenge`（目前密碼）、`password`（新密碼，最少 8 字）、`password_confirmation`（可選）。目前密碼錯 → 422 `invalid_current_password`；新密碼唔符 validation → 422 `validation_error`；成功 → 200 回更新後嘅 user。已有 JWT 唔會失效（無 token rotation）。

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
| PATCH  | `/merchants/:id`         | update（name／default_category_id）        |
| DELETE | `/merchants/:id`         | hard delete（交易 `merchant_id` SET NULL） |

### 3.5 Transactions

| Method | Path                          | 說明                                                                                                                                                                                                               |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/transactions`               | filter: `from, to, kind, category_id, account_id, merchant_id, q, min_amount, max_amount`（`q` 以 `LIKE` 比對 `note`、`payment_method`、merchant name）；sort: `occurred_at, amount_cents, created_at`；pagination |
| POST   | `/transactions`               | create（支援 `Idempotency-Key`、可選 `image_urls`）                                                                                                                                                                |
| GET    | `/transactions/:id`           | show                                                                                                                                                                                                               |
| PATCH  | `/transactions/:id`           | update                                                                                                                                                                                                             |
| DELETE | `/transactions/:id`           | hard delete                                                                                                                                                                                                        |
| POST   | `/transactions/:id/duplicate` | 複製一筆（`occurred_at = now`）                                                                                                                                                                                    |

- `from` / `to` **必須同時提供**才會 filter；`to` 會取當日 end-of-day（Asia/Hong_Kong）
- sort 只接受 `occurred_at` / `amount_cents` / `created_at`，前置 `-` 為降序；其他值回落 `occurred_at`
- `per_page` 上限 100（clamp），預設 25
- `create` 成功會 `increment!(:usage_count)` 對應 merchant
- `duplicate` 複製欄位，`occurred_at = now`，`source` 保持原值

### 3.6 Recurring Rules

| Method | Path                             | 說明                                                |
| ------ | -------------------------------- | --------------------------------------------------- |
| GET    | `/recurring_rules`               | list（可選 `?status=active\|paused\|ended` filter） |
| POST   | `/recurring_rules`               | create                                              |
| PATCH  | `/recurring_rules/:id`           | update                                              |
| DELETE | `/recurring_rules/:id`           | hard delete（已產生交易保留）                       |
| POST   | `/recurring_rules/:id/pause`     | 暫停                                                |
| POST   | `/recurring_rules/:id/resume`    | 恢復                                                |
| POST   | `/recurring_rules/:id/run_now`   | 手動觸發一次                                        |
| POST   | `/recurring_rules/:id/skip_next` | 跳過下一次                                          |

### 3.7 Receipts / AI

| Method | Path               | 說明                                                               |
| ------ | ------------------ | ------------------------------------------------------------------ |
| POST   | `/receipts/upload` | 上傳圖片 → LIHKG → 回 `{ url, sha256 }`（**唔**寫 Attachment）     |
| POST   | `/ai/parse`        | 傳 `image_url` → DeepSeek `deepseek-flash` → preview               |
| POST   | `/ai/interpret`    | 傳 `text`（1–500 字）→ DeepSeek 解析一句自然語言（可拆多筆）→ 同一款 preview |
| POST   | `/ai/query`        | 傳 `text`（1–500 字）→ DeepSeek 譯成 transaction-list filter params（唔入帳、唔寫 DB） |
| POST   | `/ai/confirm`      | 用戶確認 → 建立 transaction（寫入 `image_urls`），關聯 AiImportLog |

> **注意**：`/ai/parse` 只接受 whitelist host 嘅 URL（預設 `img.eservice-hk.net`），防 SSRF。唔用 Attachment model。

**`/ai/parse`**：`{ "image_url": "https://..." }` → 回 `{ id, source, image_urls, sha256, status, parsed, suggested_category_id, parsed_items, raw_response, error, tokens_in, tokens_out, latency_ms }`。`status = failed` 回 502 `upstream_error`；`partial` 回 200。`parsed_items` 係 `[{ parsed, suggested_category_id }]`，receipt 只有一筆。

**`/ai/interpret`**：`{ "text": "尋日茶餐廳 45 蚊" }` → 同一款 preview（`source = text`、`image_urls = []`）。**一句可以拆多筆**：`parsed_items` 逐筆列出（最多 20 筆），`parsed`／`suggested_category_id` 保留第一筆方便舊 consumer；每筆都獨立做 category hint 正規化，`suggested_category_id` 對唔上當前用戶分類時為 `null`。缺 `text`／空白／超過 500 字 → 422 `validation_error`；一句都拆唔到（model 回空 array／冇有效金額）→ 200 `status = partial`、`parsed = null`、`parsed_items = []`；DeepSeek 失敗 → 502 `upstream_error`。後端會開一條 `source = text` 嘅 `AiImportLog`（`parsed_json` 存成 array），所以 `/ai/confirm` 可以逐筆照用（`image_urls = []`）。

**`/ai/query`**：`{ "text": "上月喺 Starbucks 洗咗幾多" }` → `{ status, filters, explanation, error, tokens_in, tokens_out, latency_ms }`。後端將問題譯成**現有 transaction-list filter params**，唔會寫入 DB、亦唔開 `AiImportLog`（純讀取翻譯）。`filters` 用 URL 同名 keys：`from`／`to`（`YYYY-MM-DD`，永遠成對出現或同時缺省）／`kind`／`account_id`／`category_id`／`merchant_id`／`q`／`min`／`max`（cents）；account／category／merchant 由 model 用名稱指出，後端再對當前用戶名稱（不分大小寫）解析成 id，對唔上嘅 merchant 名回落 `q`，對唔上嘅 account／category 直接略去。model 完全譯唔到可用條件 → 200 `status = partial`、`filters = null`。缺 `text`／空白／超過 500 字 → 422 `validation_error`；DeepSeek 失敗 → 502 `upstream_error`。前端只負責將 `filters` 寫入交易列表 URL。

**`/ai/confirm`**：body 需帶 `ai_import_log_id`（或 `import_log_id`）＋ transaction 欄位；建 transaction（`source = ai`，`image_urls` 未提供時用 log 嘅），回填 `AiImportLog.transaction_id`。支援 `Idempotency-Key`。多筆 preview 逐筆 confirm 時會共用同一條 log，`transaction_id` 最後一筆覆蓋之前（單一欄位，唔另開關聯表）。`receipts/upload` 成功回 201。

> `ai/confirm` 同 `recurring_rules/:id/run_now` 回嘅 transaction payload 仍帶 legacy `net_amount_cents` key，等同 `amount_cents`（退款已移除）。

### 3.8 Dashboard

| Method | Path         | 說明                                               |
| ------ | ------------ | -------------------------------------------------- |
| GET    | `/dashboard` | 總收入、總支出、淨額、最近交易、分類佔比、帳戶餘額 |

- 可選 `?date=YYYY-MM-DD` 指定月份（預設當月，Asia/Hong_Kong）
- `income_cents` / `expense_cents` / `net_cents` 只計該月（transfer 不計）
- `by_category`：每行 `{ category_id, name, income_cents, expense_cents }`，按 expense 降序、再 income 降序
- 餘額同時以 `accounts` 同 `account_balances` 兩個 key 回傳（每個 `{ id, name, currency, initial_balance_cents, balance_cents }`；balance = initial + income - expense，transfer 不計）
- 7 日內到期嘅 active recurring rule 同時以 `upcoming_recurring` 同 `recurring_reminders` 回傳

### 3.9 Summaries

| Method | Path                                 | 說明              |
| ------ | ------------------------------------ | ----------------- |
| GET    | `/summaries/daily?date=2026-09-14`   | 單日              |
| GET    | `/summaries/weekly?date=2026-09-14`  | 該週（Mon-Sun）   |
| GET    | `/summaries/monthly?date=2026-09-14` | 該月（1 號-月末） |

各期間都會回 `daily`（按香港時區逐日分組嘅淨收支，transfer 不計，只有 `{ date, net_cents }`）；月報用嚟畫收支日曆。`date` 參數預設今日（Asia/Hong_Kong）；`page` / `per_page`（上限 100）用於期內 `transactions` 分頁。

**回應格式**：

```json
{
  "data": {
    "range": { "from": "...", "to": "..." },
    "income_cents": 100000,
    "expense_cents": 50000,
    "net_cents": 55000,
    "daily": [
      { "date": "2026-09-14", "net_cents": 55000 }
    ],
    "by_category": [
      { "category_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "name": "飲食", "income_cents": 0, "expense_cents": 30000 }
    ],
    "by_account": [
      { "account_id": "...", "name": "現金", "income_cents": 0, "expense_cents": 30000 }
    ],
    "transfers": { "count": 3, "total_cents": 200000 },
    "transactions": { "data": [...], "meta": {...} }
  }
}
```

`by_category` 按 `expense_cents` 降序、再 `income_cents` 降序排列。

**AI 收支概況**：`GET /summaries/{period}/insight?date=2026-09-16[&refresh=1]`

- 只支援 `weekly` / `monthly`；`daily`（以及其他期間）→ 422 `validation_error`（日報太短，冇洞察價值）。
- 以 `(user, period, period_key, fingerprint)` cache；指紋 = 該期 deterministic summary 數字嘅 hash，交易一改就失效重算（**唔會**喺寫入交易時 eager 更新）。
- 模型只可以重述後端預先算好嘅數字同期內每筆交易（fact sheet 會列出日期、收支類型、分類名、商戶名、金額、備註；備註會壓平換行但唔截短）；輸出含「唔喺 fact sheet 出現過」嘅數字 → reject（`status = failed`）。
- 冇任何收入／支出／轉帳 → `status = empty`，唔會 call DeepSeek。
- `refresh=1` 強制重算（繞過 cache）。
- DeepSeek upstream 失敗 → 502 `upstream_error`。

```json
{
  "data": {
    "period": "monthly",
    "range": { "from": "...", "to": "..." },
    "status": "success",
    "text": "2026年9月收入 HK$1,000.00，支出 HK$400.00，淨額 HK$600.00。",
    "highlights": ["支出主要集中喺飲食。"],
    "cached": false,
    "generated_at": "2026-09-16T12:00:00+08:00",
    "error": null,
    "tokens_in": 120,
    "tokens_out": 80,
    "latency_ms": 900
  }
}
```

`status`：`success`（有 `text`）／`failed`（模型被 reject 或解析失敗，`error` 有原因）／`empty`（期間無數據）。

### 3.10 Health

| Method | Path               | 說明                  |
| ------ | ------------------ | --------------------- |
| GET    | `/up`              | Rails 8 內建 liveness |
| GET    | `/health`          | 整體                  |
| GET    | `/health/db`       | DB 連線 + WAL         |
| GET    | `/health/deepseek` | DeepSeek ping         |
| GET    | `/health/lihkg`    | LIHKG 圖床 ping       |

- Health endpoint 全部喺 **root**（唔喺 `/api/v1`），唔經 `ApplicationController`、唔需要 JWT
- 回 `{ status: "ok" | "error", checks: { ... } }`；任何 check 唔 ok → HTTP 503
- DB check 讀 `PRAGMA journal_mode` 確認 WAL；DeepSeek check 打 `/models`；LIHKG check 打 `LIHKG_HEALTHCHECK_URL`（fallback `LIHKG_UPLOAD_URL`）並帶 `Origin: https://lihkg.com`
